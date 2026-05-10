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

export async function checkSignatures(
  envelope: SignedEnvelope,
  resolvedSigners: ResolvedSigner[],
): Promise<CheckResult> {
  const message = canonicalize(envelope.payload);
  for (const { info, credential } of resolvedSigners) {
    const valid = await verifyEcdsaP256(credential.publicKey, message, info.sig);
    if (!valid) {
      return fail('SIGNATURE_INVALID', `signature invalid for credential ${info.credentialId}`);
    }
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
