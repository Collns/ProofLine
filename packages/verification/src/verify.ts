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
   * PFL-125 backward-compat. Old `signed_messages` rows written before
   * PFL-125 carry a WebAuthn assertion signature without the
   * authenticatorData + clientDataJSON needed to reconstruct what was
   * signed. When this flag is true, such rows produce a console warning
   * and skip the signature check rather than tripping SIGNATURE_INVALID.
   * Newly written envelopes carry the artifacts and verify properly
   * regardless of this flag.
   *
   * Defaults to false in the library so tests catch real regressions.
   * The production verify handler turns it on.
   */
  legacySignatureFallback?: boolean;
  /**
   * PFL-100.1 outstanding work: the register-credential handler still
   * stamps `issuerSig: ""` on newly-enrolled role credentials because
   * company-root signing infrastructure (KMS, PFL-126) isn't live yet.
   * When this flag is true, credentials with an empty issuerSig skip
   * the chain check; credentials that DO have an issuerSig are still
   * verified. Drop this flag once issuerSig is populated everywhere.
   */
  trustUnsignedRoleCredentials?: boolean;
  /**
   * PFL-106: the anchor batch stamps the on-chain coordinates
   * (root/blockNumber/timestamp) onto each signed_messages row after it
   * runs. The verify handler reads them off the row and passes them in
   * here so we don't re-fetch the chain at verify time. When present,
   * checkAnchor is bypassed in favour of the trusted coordinates. When
   * absent we fall back to the on-chain lookup, OR — paired with
   * `trustUnsignedRoleCredentials` for not-yet-anchored envelopes — a
   * pending sentinel anchor (root=0x0…, block=0).
   */
  trustedAnchor?: Anchor;
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
    ...(s.info.authenticatorData ? { authenticatorData: s.info.authenticatorData } : {}),
    ...(s.info.clientDataJSON    ? { clientDataJSON:    s.info.clientDataJSON    } : {}),
  };
}

export async function verifyEnvelope(input: VerifyEnvelopeInput): Promise<VerificationResult> {
  const nowMs = input.now?.() ?? Date.now();
  const { envelope, registry } = input;
  const trustUnsignedRoleCredentials = input.trustUnsignedRoleCredentials === true;

  const c1 = await checkPayloadIntegrity(envelope);
  if (!c1.ok) return rejected(c1);

  const c2 = await checkSignerIdentities(envelope, registry);
  if (!c2.ok) return rejected(c2);

  // PFL-125: signature check is ALWAYS run. New envelopes carry the
  // WebAuthn artifacts and verify properly; legacy envelopes without
  // them either fall through the canonical-bytes path or — under
  // legacySignatureFallback — log a warning and continue.
  const c3 = await checkSignatures(envelope, c2.signers, {
    legacySignatureFallback: input.legacySignatureFallback === true,
  });
  if (!c3.ok) {
    // F-VER-07: signer identity resolved to a verified ProofLine company,
    // but the signature itself didn't verify — treat as spoof attempt
    // against a known domain rather than a generic rejection.
    if (c3.code === 'SIGNATURE_INVALID' && c2.signers.length > 0) {
      return suspectedSpoof(c2.signers[0].company, c3.detail);
    }
    return rejected(c3);
  }

  // PFL-100.1: credentials with `issuerSig === ""` bypass the chain
  // check when trustUnsignedRoleCredentials is on (no company-root KMS
  // yet — see PFL-126). Credentials that DO carry an issuerSig are
  // always verified.
  const credsNeedingChainCheck = trustUnsignedRoleCredentials
    ? c2.signers.filter((s) => s.credential.issuerSig !== '')
    : c2.signers;
  if (credsNeedingChainCheck.length > 0) {
    const c4 = await checkRoleCredentials(envelope, credsNeedingChainCheck, c2.companies);
    if (!c4.ok) return rejected(c4);
  }

  // Anchor resolution (PFL-106): the verify handler stamps the on-chain
  // coordinates onto each envelope, so we prefer those over a live
  // chain read. An un-anchored envelope (no trusted anchor + no
  // anchorRoot) renders as a "pending" sentinel anchor when the caller
  // permits unsigned role credentials (i.e., the in-app verify page,
  // which already treats not-yet-anchored as a transient state). The
  // strict path falls through to the on-chain check below.
  let anchor: Anchor;
  if (input.trustedAnchor) {
    anchor = input.trustedAnchor;
  } else if (
    trustUnsignedRoleCredentials &&
    (envelope.anchorRoot === null || envelope.anchorRoot === undefined)
  ) {
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
