import type { SignedEnvelope } from '@proofline/types';
import type { RegistryView, VerificationResult, CheckFailure, VerifiedSignerInfo, Company, Anchor, Hex32 } from './types.js';
import type { ResolvedSigner } from './checks.js';
import {
  checkPayloadIntegrity,
  checkSignerIdentities,
  checkSignatures,
  checkRoleCredentials,
  checkAnchor,
  checkFreshness,
  checkPolicy,
} from './checks.js';

export interface VerifyEnvelopeInput {
  envelope: SignedEnvelope;
  registry: RegistryView;
  now?: () => number;  // unix ms; default Date.now
  /**
   * PFL-101: hackathon escape hatch. When true, three load-bearing
   * verification checks are skipped because the current end-to-end
   * pipeline cannot satisfy them yet:
   *
   *   1. checkSignatures — the stored `signer.sig` is a WebAuthn
   *      assertion signature over `clientDataJSON + authenticatorData`,
   *      NOT over `canonicalize(payload)`. The signing endpoint
   *      (sign-finalize) verifies the WebAuthn assertion server-side
   *      via finishAssertion BEFORE recording the envelope, so the
   *      envelope already carries an authenticator-validated signature
   *      — just one this raw-ECDSA verifier cannot reconstruct without
   *      the original clientDataJSON+authenticatorData (which we don't
   *      store). Skipped under trust mode.
   *
   *   2. checkRoleCredentials — skipped only for credentials whose
   *      `issuerSig` is empty. The register-credential handler stores
   *      `issuerSig: ""` until PFL-100.1 wires up company-root signing.
   *      Credentials with a non-empty issuerSig still get checked.
   *
   *   3. checkAnchor — skipped when `envelope.anchorRoot` is null/missing.
   *      Envelopes are recorded at sign time but anchored on a delayed
   *      batch (anchoring service). Under trust mode an unanchored
   *      envelope is treated as `verified` with a sentinel anchor
   *      (root=0x0…, block=0, timestamp=0).
   *
   * Default is `false`. Tests and any caller that wants the full
   * cryptographic guarantees should leave it off.
   *
   * TODO(PFL-101.x): once (a) the signing endpoint records the
   * raw payload signature, (b) issuerSig is real, and (c) anchoring
   * runs synchronously enough to be present at verify time — drop
   * this flag entirely.
   */
  trustWebauthnAtSignTime?: boolean;
}

const SENTINEL_ANCHOR: Anchor = {
  root: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex32,
  blockNumber: 0n,
  timestamp: 0n,
};

function rejected(failure: CheckFailure): VerificationResult {
  return { ok: false, state: 'rejected', code: failure.code, detail: failure.detail };
}

function suspectedSpoof(company: Company, detail: string): VerificationResult {
  return {
    ok: true,
    state: 'suspected_spoof',
    claimedCompany: {
      companyId: company.companyId,
      domain: company.domain,
      legalName: company.legalName,
    },
    detail,
  };
}

function toVerifiedSignerInfo(s: ResolvedSigner): VerifiedSignerInfo {
  return {
    userId: s.info.userId,
    credentialId: s.info.credentialId,
    role: s.credential.role,
    sig: s.info.sig,
    signedAt: s.info.signedAt,
    sessionId: s.info.sessionId,
    companyId: s.company.companyId,
    companyDomain: s.company.domain,
    companyLegalName: s.company.legalName,
    userDisplayName: s.user.displayName,
  };
}

export async function verifyEnvelope(input: VerifyEnvelopeInput): Promise<VerificationResult> {
  const nowMs = input.now?.() ?? Date.now();
  const { envelope, registry } = input;
  const trust = input.trustWebauthnAtSignTime === true;

  const c1 = await checkPayloadIntegrity(envelope);
  if (!c1.ok) return rejected(c1);

  const c2 = await checkSignerIdentities(envelope, registry);
  if (!c2.ok) return rejected(c2);

  if (!trust) {
    const c3 = await checkSignatures(envelope, c2.signers);
    if (!c3.ok) {
      // F-VER-07: signer identity resolved to a verified ProofLine company,
      // but the signature itself didn't verify — treat as spoof attempt
      // against a known domain rather than a generic rejection.
      if (c3.code === 'SIGNATURE_INVALID' && c2.signers.length > 0) {
        return suspectedSpoof(c2.signers[0].company, c3.detail);
      }
      return rejected(c3);
    }
  }

  // Under trust mode, credentials with `issuerSig === ""` bypass the
  // chain check (PFL-100.1 will provide real issuer signatures).
  // Credentials that DO have an issuerSig are still verified — partial
  // hardening as the company-root signing rollout completes.
  const credsNeedingChainCheck = trust
    ? c2.signers.filter((s) => s.credential.issuerSig !== '')
    : c2.signers;
  if (credsNeedingChainCheck.length > 0) {
    const c4 = await checkRoleCredentials(envelope, credsNeedingChainCheck, c2.companies);
    if (!c4.ok) return rejected(c4);
  }

  let anchor: Anchor;
  if (trust && (envelope.anchorRoot === null || envelope.anchorRoot === undefined)) {
    anchor = SENTINEL_ANCHOR;
  } else {
    const c5 = await checkAnchor(envelope, registry);
    if (!c5.ok) return rejected(c5);
    anchor = c5.anchor;
  }

  const c6 = await checkFreshness(envelope, registry, nowMs);
  if (!c6.ok) return rejected(c6);

  const c7 = await checkPolicy(envelope, c2.signers);
  if (!c7.ok) return rejected(c7);

  const isBilateral = envelope.payloadType === 'bilateral';

  return {
    ok: true,
    state: isBilateral ? 'bilateral' : 'verified',
    signers: c2.signers.map(toVerifiedSignerInfo),
    payload: envelope.payload,
    anchor,
  };
}
