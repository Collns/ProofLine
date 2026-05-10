import { VerifyBadge } from './VerifyBadge';
import type { VerificationResponse } from '../api/types';

interface Props {
  result: VerificationResponse;
}

function getHeadline(result: VerificationResponse): string {
  switch (result.state) {
    case 'verified':
      return 'Verified by ProofLine';
    case 'bilateral':
      return 'Bilaterally signed';
    case 'suspected_spoof':
      return 'Suspected spoof';
    case 'rejected':
      return 'Verification failed';
    case 'unverified_sender':
      return 'This sender is not on ProofLine';
  }
}

function getSubhead(result: VerificationResponse): string | null {
  if (result.state === 'verified' && result.signers.length > 0) {
    const s = result.signers[0];
    return `${s.userDisplayName} at ${s.companyLegalName} (${s.companyDomain})`;
  }
  if (result.state === 'bilateral' && result.signers.length >= 2) {
    const drafter = result.signers[0];
    const counterparty = result.signers[1];
    return `Signed by ${drafter.companyLegalName} and ${counterparty.companyLegalName}`;
  }
  if (result.state === 'suspected_spoof') {
    return `This message claims to be from ${result.claimedCompany.domain}, a verified ProofLine sender, but it carries no valid ProofLine signature. Treat as suspicious.`;
  }
  if (!result.ok && result.state === 'rejected') {
    return humanizeRejectionCode(result.code);
  }
  if (result.state === 'unverified_sender') {
    return 'ProofLine cannot verify messages from senders who are not enrolled. This is not a sign of fraud — it just means there is no signature to check.';
  }
  return null;
}

function humanizeRejectionCode(code: string): string {
  const map: Record<string, string> = {
    PAYLOAD_HASH_MISMATCH: 'Payload tampered — message content does not match the signed hash',
    PAYLOAD_EXPIRED: 'Signature expired — the validity window for this message has passed',
    NONCE_REPLAYED: 'Replay detected — this message has already been verified once',
    CREDENTIAL_REVOKED: 'Signing device revoked — the credential used to sign this message is no longer valid',
    COMPANY_UNKNOWN: 'Sender organization not recognized',
    COMPANY_SUSPENDED: 'Sender organization is suspended',
    USER_DEACTIVATED: 'Signer account is deactivated',
    ROLE_CREDENTIAL_INVALID: 'Signing credential is invalid',
    SIGNATURE_INVALID: 'Cryptographic signature is invalid',
    ANCHOR_MISSING: 'No blockchain anchor found for this message',
    ANCHOR_NOT_ON_CHAIN: 'Anchor root is not confirmed on-chain',
    POLICY_AUTHORITY_EXCEEDED_AT_SIGNING: 'Signer did not have authority for this amount',
    BILATERAL_INCOMPLETE: 'Bilateral document is missing required signatures',
    BILATERAL_PARTIES_MISMATCH: 'Signers do not represent the expected counterparties',
  };
  return map[code] ?? code;
}

export function VerifyHeader({ result }: Props) {
  const headline = getHeadline(result);
  const subhead = getSubhead(result);

  return (
    <header className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <VerifyBadge state={result.state} size="lg" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-[#0B1F3A] leading-tight">{headline}</h1>
      {subhead && (
        <p className="text-base text-gray-600 leading-relaxed">{subhead}</p>
      )}
    </header>
  );
}
