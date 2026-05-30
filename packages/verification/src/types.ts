import type {
  WirePayload,
  EmailPayload,
  BilateralPayload,
  RoleCredential,
} from '@proofline/types';

export type { RoleCredential };

export type Hex32 = `0x${string}`;

export interface Anchor {
  root: Hex32;
  blockNumber: bigint;
  timestamp: bigint;  // unix seconds
}

export interface VerifiedSignerInfo {
  userId: string;
  credentialId: string;
  role: string;
  sig: string;
  signedAt: number;
  sessionId: string | null;
  companyId: string;
  companyDomain: string;
  companyLegalName: string;
  userDisplayName: string;
  // PFL-125: surfaced so consumers (verify-page UI, downstream auditors)
  // can re-derive the bytes the authenticator signed without re-parsing
  // the underlying envelope.
  authenticatorData?: string;  // base64url
  clientDataJSON?:    string;  // base64url
}

export interface Company {
  companyId: string;
  domain: string;
  legalName: string;
  rootPublicKey: string;   // SPKI base64
  status: 'verified' | 'suspended' | 'revoked';
  verifiedAt: number;
}

export interface User {
  userId: string;
  companyId: string;
  displayName: string;
  role: 'owner' | 'manager' | 'employee';
  status: 'active' | 'deactivated';
}

/**
 * Pure data-access boundary for verification. No Firestore, no chain, no I/O.
 * Apps wire concrete adapters.
 */
export interface RegistryView {
  getCompany(companyId: string): Promise<Company | null>;
  getCompanyByDomain(domain: string): Promise<Company | null>;
  getUser(userId: string): Promise<User | null>;
  getUserCredential(credentialId: string): Promise<RoleCredential | null>;
  isRevoked(credentialId: string): Promise<boolean>;
  isNonceUsed(nonce: string): Promise<boolean>;
  getLatestAnchor(): Promise<Anchor | null>;
  getAnchorForRoot(root: Hex32): Promise<Anchor | null>;
}

export type VerificationFailureCode =
  | 'PAYLOAD_HASH_MISMATCH'
  | 'COMPANY_UNKNOWN'
  | 'COMPANY_SUSPENDED'
  | 'COMPANY_REVOKED'
  | 'USER_UNKNOWN'
  | 'USER_DEACTIVATED'
  | 'CREDENTIAL_UNKNOWN'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_NOT_FOR_USER'
  | 'SIGNATURE_INVALID'
  | 'ROLE_CREDENTIAL_INVALID'
  | 'ANCHOR_MISSING'
  | 'ANCHOR_NOT_ON_CHAIN'
  | 'PAYLOAD_EXPIRED'
  | 'NONCE_REPLAYED'
  | 'POLICY_AUTHORITY_EXCEEDED_AT_SIGNING'
  | 'BILATERAL_INCOMPLETE'
  | 'BILATERAL_PARTIES_MISMATCH';

export type VerificationState =
  | 'verified'
  | 'bilateral'
  | 'rejected'
  | 'suspected_spoof';

export type VerificationResult =
  | {
      ok: true;
      state: 'verified' | 'bilateral';
      signers: VerifiedSignerInfo[];
      payload: WirePayload | EmailPayload | BilateralPayload;
      anchor: Anchor;
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
    };

// Internal check result shapes used within checks.ts / verify.ts
export type CheckFailure = { ok: false; code: VerificationFailureCode; detail: string };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type CheckOk<T = {}> = { ok: true } & T;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type CheckResult<T = {}> = CheckOk<T> | CheckFailure;
