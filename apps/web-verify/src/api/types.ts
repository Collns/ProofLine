import type { VerifiedSignerInfo, VerificationFailureCode } from '@proofline/verification';
import type { WirePayload, EmailPayload, BilateralPayload } from '@proofline/types';

export interface SerializedAnchor {
  root: string;
  blockNumber: string;
  timestamp: string;
}

export type VerificationResponse =
  | {
      ok: true;
      state: 'verified' | 'bilateral';
      signers: VerifiedSignerInfo[];
      payload: WirePayload | EmailPayload | BilateralPayload;
      anchor: SerializedAnchor;
    }
  | {
      ok: true;
      state: 'suspected_spoof';
      claimedCompany: { companyId: string; domain: string; legalName: string };
      detail: string;
    }
  | {
      ok: false;
      state: 'rejected';
      code: VerificationFailureCode;
      detail: string;
    }
  | {
      ok: true;
      state: 'unverified_sender';
    };
