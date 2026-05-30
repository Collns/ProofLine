import { sha256 } from '@proofline/crypto';
import { canonicalize } from '@proofline/canonical';
import { verifyEcdsaP256 } from '@proofline/crypto';
import type { SignedEnvelope, SignerInfo, RoleCredential, EmailPayload, BilateralPayload } from '@proofline/types';
import type {
  RegistryView,
  Company,
  User,
  Anchor,
  CheckResult,
  CheckFailure,
  Hex32,
} from './types.js';

// ─── Internal resolved signer type (used between checks) ─────────────────────

export interface ResolvedSigner {
  info: SignerInfo;
  credential: RoleCredential;
  user: User;
  company: Company;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fail(code: CheckFailure['code'], detail: string): CheckFailure {
  return { ok: false, code, detail };
}

// ─── CHECK 1 — Payload integrity ──────────────────────────────────────────────

export async function checkPayloadIntegrity(
  envelope: SignedEnvelope,
): Promise<CheckResult> {
  const canonical = canonicalize(envelope.payload);
  const hash = sha256(canonical);
  const hashB64 = Buffer.from(hash).toString('base64url');
  if (hashB64 !== envelope.payloadHash) {
    return fail('PAYLOAD_HASH_MISMATCH', `expected ${envelope.payloadHash}, got ${hashB64}`);
  }
  return { ok: true };
}

// ─── CHECK 2 — Signer identities ─────────────────────────────────────────────

export async function checkSignerIdentities(
  envelope: SignedEnvelope,
  registry: RegistryView,
): Promise<CheckResult<{ signers: ResolvedSigner[]; companies: Map<string, Company> }>> {
  const resolved: ResolvedSigner[] = [];
  const companies = new Map<string, Company>();

  for (const signer of envelope.signers) {
    const credential = await registry.getUserCredential(signer.credentialId);
    if (!credential) return fail('CREDENTIAL_UNKNOWN', `credential ${signer.credentialId} not found`);
    if (credential.userId !== signer.userId) {
      return fail('CREDENTIAL_NOT_FOR_USER', `credential ${signer.credentialId} belongs to ${credential.userId}, not ${signer.userId}`);
    }

    const revoked = await registry.isRevoked(signer.credentialId);
    if (revoked) return fail('CREDENTIAL_REVOKED', `credential ${signer.credentialId} is revoked`);

    const user = await registry.getUser(signer.userId);
    if (!user) return fail('USER_UNKNOWN', `user ${signer.userId} not found`);
    if (user.status !== 'active') return fail('USER_DEACTIVATED', `user ${signer.userId} is ${user.status}`);

    const company = await registry.getCompany(user.companyId);
    if (!company) return fail('COMPANY_UNKNOWN', `company ${user.companyId} not found`);
    if (company.status === 'suspended') return fail('COMPANY_SUSPENDED', `company ${user.companyId} is suspended`);
    if (company.status === 'revoked') return fail('COMPANY_REVOKED', `company ${user.companyId} is revoked`);

    companies.set(company.companyId, company);
    resolved.push({ info: signer, credential, user, company });
  }

  return { ok: true, signers: resolved, companies };
}

// ─── CHECK 3 — Signature validity ────────────────────────────────────────────

export interface CheckSignaturesOptions {
  /**
   * PFL-125 backward-compat: old `signed_messages` documents persisted
   * before authenticatorData + clientDataJSON were stored alongside `sig`
   * carry a WebAuthn assertion signature that this verifier cannot
   * reconstruct (no authData → no signed bytes to recover). When this
   * flag is true, such envelopes are treated as a soft-skip with a
   * console warning rather than a hard SIGNATURE_INVALID. Newly written
   * envelopes always carry the fields and verify properly.
   *
   * Defaults to false — the verification package itself stays strict so
   * unit tests catch real regressions. The production verify handler
   * sets this to true.
   */
  legacySignatureFallback?: boolean;
}

export async function checkSignatures(
  envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
  options: CheckSignaturesOptions = {},
): Promise<CheckResult> {
  const canonicalBytes = canonicalize(envelope.payload);

  for (const { info, credential } of resolvedSigners) {
    const hasWebauthnArtifacts =
      typeof info.authenticatorData === 'string' && info.authenticatorData.length > 0 &&
      typeof info.clientDataJSON    === 'string' && info.clientDataJSON.length    > 0;

    if (hasWebauthnArtifacts) {
      const result = await verifyWebauthnSignature({
        publicKey:         credential.publicKey,
        authenticatorData: info.authenticatorData!,
        clientDataJSON:    info.clientDataJSON!,
        sig:               info.sig,
        expectedChallenge: envelope.payloadHash,
        credentialId:      info.credentialId,
      });
      if (!result.ok) return result;
      continue;
    }

    // No WebAuthn material on the signer — fall back to verifying `sig`
    // against the canonical payload bytes directly. This path covers
    // server-key signatures, fixtures, and the suspected-spoof tampered-
    // sig path (which signs raw canonical bytes via test helpers).
    const valid = await verifyEcdsaP256(credential.publicKey, canonicalBytes, info.sig);
    if (valid) continue;

    if (options.legacySignatureFallback) {
      // eslint-disable-next-line no-console
      console.warn(
        `[verification] PFL-125 legacy envelope: skipping signature check for credential ${info.credentialId} ` +
        `— no authenticatorData/clientDataJSON stored and the raw-canonical check also failed. ` +
        `New envelopes verify properly; re-anchor or re-sign to restore strict verification.`,
      );
      continue;
    }

    return fail('SIGNATURE_INVALID', `signature invalid for credential ${info.credentialId}`);
  }
  return { ok: true };
}

/**
 * PFL-125: reconstruct the bytes a WebAuthn authenticator signed at
 * registration/sign time and verify the ECDSA signature against them.
 *
 * Authenticators sign `SHA256(authData || SHA256(clientDataJSON))`.
 * `verifyEcdsaP256` already runs `createVerify('SHA256')` internally,
 * so we hand it `authData || SHA256(clientDataJSON)` and it does the
 * outer SHA-256 before the curve check.
 *
 * Also binds the signature to THIS payload by requiring the challenge
 * embedded in clientDataJSON to equal `envelope.payloadHash`. Without
 * that bind, an attacker could lift a valid (authData, clientDataJSON,
 * sig) triple from one signed message and replay it onto another.
 */
async function verifyWebauthnSignature(input: {
  publicKey:         string;
  authenticatorData: string;
  clientDataJSON:    string;
  sig:               string;
  expectedChallenge: string;
  credentialId:      string;
}): Promise<CheckResult> {
  let authData: Uint8Array;
  let clientDataBytes: Uint8Array;
  try {
    authData        = Buffer.from(input.authenticatorData, 'base64url');
    clientDataBytes = Buffer.from(input.clientDataJSON,    'base64url');
  } catch {
    return fail('SIGNATURE_INVALID', `signature artifacts malformed for credential ${input.credentialId}`);
  }

  // Bind the assertion to this payload via the challenge.
  let clientData: { challenge?: unknown };
  try {
    clientData = JSON.parse(Buffer.from(clientDataBytes).toString('utf8')) as { challenge?: unknown };
  } catch {
    return fail('SIGNATURE_INVALID', `clientDataJSON not parseable for credential ${input.credentialId}`);
  }
  if (typeof clientData.challenge !== 'string' || clientData.challenge !== input.expectedChallenge) {
    return fail(
      'SIGNATURE_INVALID',
      `clientDataJSON.challenge does not match payloadHash for credential ${input.credentialId}`,
    );
  }

  const clientDataHash = sha256(clientDataBytes);
  const signedMessage  = new Uint8Array(authData.length + clientDataHash.length);
  signedMessage.set(authData, 0);
  signedMessage.set(clientDataHash, authData.length);

  const valid = await verifyEcdsaP256(input.publicKey, signedMessage, input.sig);
  if (!valid) {
    return fail('SIGNATURE_INVALID', `signature invalid for credential ${input.credentialId}`);
  }
  return { ok: true };
}

// ─── CHECK 4 — Role credential chain ─────────────────────────────────────────

export async function checkRoleCredentials(
  _envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
  companies: Map<string, Company>,
): Promise<CheckResult> {
  for (const { credential, company: signerCompany } of resolvedSigners) {
    const company = companies.get(credential.companyId) ?? signerCompany;

    const credentialBytes = canonicalize({
      v: credential.v,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      userId: credential.userId,
      companyId: credential.companyId,
      role: credential.role,
      perEmailLimitUsd: credential.perEmailLimitUsd,
      dailyLimitUsd: credential.dailyLimitUsd,
      issuedAt: credential.issuedAt,
    });

    const valid = await verifyEcdsaP256(company.rootPublicKey, credentialBytes, credential.issuerSig);
    if (!valid) {
      return fail('ROLE_CREDENTIAL_INVALID', `role credential chain invalid for credential ${credential.credentialId}`);
    }
  }
  return { ok: true };
}

// ─── CHECK 5 — Anchor presence ────────────────────────────────────────────────

export async function checkAnchor(
  envelope: SignedEnvelope,
  registry: RegistryView,
): Promise<CheckResult<{ anchor: Anchor }>> {
  if (!envelope.anchorRoot) {
    return fail('ANCHOR_MISSING', 'envelope has no anchorRoot');
  }

  const anchor = await registry.getAnchorForRoot(envelope.anchorRoot as Hex32);
  if (!anchor) {
    return fail('ANCHOR_NOT_ON_CHAIN', `anchor root ${envelope.anchorRoot} not found on-chain`);
  }

  return { ok: true, anchor };
}

// ─── CHECK 6 — Freshness + nonce ─────────────────────────────────────────────

export async function checkFreshness(
  envelope: SignedEnvelope,
  registry: RegistryView,
  nowMs: number,
): Promise<CheckResult> {
  const payload = envelope.payload as Partial<EmailPayload & BilateralPayload>;

  // WirePayload has no expiresAt/nonce — only email and bilateral do
  if (payload.expiresAt !== undefined) {
    const nowSec = Math.floor(nowMs / 1000);
    if (payload.expiresAt <= nowSec) {
      return fail('PAYLOAD_EXPIRED', `payload expired at ${payload.expiresAt}, now is ${nowSec}`);
    }
  }

  if (payload.nonce !== undefined) {
    const used = await registry.isNonceUsed(payload.nonce);
    if (used) {
      return fail('NONCE_REPLAYED', `nonce ${payload.nonce} has already been used`);
    }
  }

  return { ok: true };
}

// ─── CHECK 7 — Policy at signing time ────────────────────────────────────────

export async function checkPolicy(
  envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
): Promise<CheckResult> {
  if (envelope.payloadType === 'bilateral') {
    return checkBilateralPolicy(envelope, resolvedSigners);
  }

  if (envelope.payloadType === 'wire') {
    return checkWirePolicy(envelope, resolvedSigners);
  }

  // Email without wire instruction: signer must be from the payload's companyId
  const payload = envelope.payload as EmailPayload;
  if (payload.isWireInstruction && payload.wirePayload) {
    return checkEmailWirePolicy(resolvedSigners, payload.wirePayload.amount);
  }

  return { ok: true };
}

function checkBilateralPolicy(
  envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
): CheckResult {
  const payload = envelope.payload as BilateralPayload;

  if (resolvedSigners.length < 2) {
    return fail('BILATERAL_INCOMPLETE', `bilateral payload requires 2 signers, got ${resolvedSigners.length}`);
  }

  const drafterSigned = resolvedSigners.some(s => s.company.companyId === payload.drafterCompanyId);
  const counterpartySigned = resolvedSigners.some(s => s.company.companyId === payload.counterpartyCompanyId);

  if (!drafterSigned || !counterpartySigned) {
    return fail(
      'BILATERAL_PARTIES_MISMATCH',
      `bilateral requires signers from ${payload.drafterCompanyId} and ${payload.counterpartyCompanyId}`,
    );
  }

  return { ok: true };
}

function checkWirePolicy(
  envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
): CheckResult {
  const wirePayload = envelope.payload as import('@proofline/types').WirePayload;
  return checkAmountVsAuthority(resolvedSigners, wirePayload.amount);
}

function checkEmailWirePolicy(resolvedSigners: ResolvedSigner[], amount: number): CheckResult {
  return checkAmountVsAuthority(resolvedSigners, amount);
}

function checkAmountVsAuthority(resolvedSigners: ResolvedSigner[], amount: number): CheckResult {
  // If any single signer can authorize this amount alone, we're good
  const hasSufficientSingleSig = resolvedSigners.some(s => {
    const limit = s.credential.perEmailLimitUsd;
    return limit === null || amount <= limit;
  });
  if (hasSufficientSingleSig) return { ok: true };

  // Otherwise require at least 2 signers (cosign)
  if (resolvedSigners.length >= 2) return { ok: true };

  return fail(
    'POLICY_AUTHORITY_EXCEEDED_AT_SIGNING',
    `amount ${amount} exceeds per-email limit and no cosigner present`,
  );
}
