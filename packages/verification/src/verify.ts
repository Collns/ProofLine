import type { SignedEnvelope } from '@proofline/types';
import type { RegistryView, VerificationResult, CheckFailure, VerifiedSignerInfo } from './types.js';
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
}

function rejected(failure: CheckFailure): VerificationResult {
  return { ok: false, state: 'rejected', code: failure.code, detail: failure.detail };
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

  const c1 = await checkPayloadIntegrity(envelope);
  if (!c1.ok) return rejected(c1);

  const c2 = await checkSignerIdentities(envelope, registry);
  if (!c2.ok) return rejected(c2);

  const c3 = await checkSignatures(envelope, c2.signers);
  if (!c3.ok) return rejected(c3);

  const c4 = await checkRoleCredentials(envelope, c2.signers, c2.companies);
  if (!c4.ok) return rejected(c4);

  const c5 = await checkAnchor(envelope, registry);
  if (!c5.ok) return rejected(c5);

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
    anchor: c5.anchor,
  };
}
