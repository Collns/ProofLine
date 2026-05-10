import type { KYBFlag } from '@proofline/kyb';
import type { KeyHandle } from '@proofline/crypto';
import type { Hex32, TxHash } from '@proofline/anchoring';
import type { RoleCredential } from '@proofline/types';

export type OnboardingStep =
  | 'start'
  | 'dns_pending'
  | 'email_pending'
  | 'kyb_pending'
  | 'kyc_pending'
  | 'finalize_pending'
  | 'finalized'
  | 'manual_review'
  | 'rejected';

export interface OnboardingState {
  onboardingId: string;
  step: OnboardingStep;
  domain: string;

  legalName?: string;
  ein?: string;
  jurisdiction?: string;
  officerEmail?: string;
  officerName?: string;

  dnsRecordName: string;
  dnsRecordValue: string;
  dnsVerifiedAt?: number;

  adminCode?: string;
  postmasterCode?: string;
  emailAttempts: number;
  emailVerifiedAt?: number;

  kybVendorRef?: string;
  kybFlags?: KYBFlag[];
  kycVendorRef?: string;
  kycVerifiedAt?: number;

  companyId?: string;
  rootKeyHandle?: KeyHandle;
  rootPublicKey?: string;
  firstRoleCredentialId?: string;
  firstRoleCredentialJson?: string;
  anchorTxHash?: TxHash;
  // bigint stringified for Firestore portability; service boundary uses bigint.
  anchorBlock?: string;
  anchorRoot?: Hex32;
  finalizedAt?: number;

  createdAt: number;
  updatedAt: number;
}

export type OnboardingError =
  | { code: 'BAD_STATE'; expected: OnboardingStep[]; actual: OnboardingStep }
  | { code: 'NOT_FOUND' }
  | { code: 'DNS_NOT_FOUND'; expected: string }
  | { code: 'CODE_INVALID' }
  | { code: 'LOCKED_OUT'; attempts: number }
  | { code: 'KYB_REJECTED'; flags: KYBFlag[] }
  | { code: 'KYB_REVIEW'; flags: KYBFlag[] }
  | { code: 'KYC_FAILED'; reason: string }
  | { code: 'KMS_FAILED'; reason: string }
  | { code: 'ANCHOR_FAILED'; reason: string }
  | { code: 'INTERNAL'; message: string };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface OnboardingStore {
  create(state: OnboardingState): Promise<void>;
  get(onboardingId: string): Promise<OnboardingState | null>;
  update(
    onboardingId: string,
    patch: Partial<OnboardingState>,
  ): Promise<OnboardingState | null>;
}

export interface DNSResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

export interface KmsKeyProvisioner {
  createCompanyRootKey(input: { companyId: string }): Promise<{
    handle: KeyHandle & { kind: 'kms' };
    publicKey: string;
  }>;
}

export interface FinalizeResult {
  companyId: string;
  rootKeyHandle: KeyHandle;
  rootPublicKey: string;
  firstRoleCredential: RoleCredential;
  anchorTxHash: TxHash;
  anchorBlock: bigint;
}

const LOCKOUT_THRESHOLD = 5;
export const EMAIL_LOCKOUT_THRESHOLD = LOCKOUT_THRESHOLD;
