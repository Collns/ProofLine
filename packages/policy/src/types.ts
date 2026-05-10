export interface PolicyRequest {
  userId: string;
  companyId: string;
  credentialId: string;
  recipientSetHash: string;
  recipientAddresses: string[];

  isWireInstruction: boolean;
  payload?: { wire?: { amount: number } };
  cosignSignatures?: unknown[];

  sessionToken?: string;
  freshBiometric: boolean;
}

export interface PolicyUser {
  userId: string;
  companyId: string;
  status: 'active' | 'inactive';
  role: 'owner' | 'manager' | 'employee' | null;
  wireLimitUsd: number;
  dailyLimitUsd: number;
  devices: Array<{
    credentialId: string;
    revokedAt?: number;
  }>;
}

export interface PolicySession {
  sessionId: string;
  userId: string;
  companyId: string;
  recipientSetHash: string;
  expiresAt: number;
  status: 'active' | 'expired' | 'revoked';
}

export interface CompanyPolicy {
  companyId: string;
  highValueThresholdUsd: number;
}

export interface PolicyCounterparty {
  domain: string;
  status: 'active' | 'deactivated';
}

export type PolicyDecision =
  | { decision: 'APPROVED' }
  | { decision: 'COSIGN_REQUIRED'; eligibleApprovers: string[] };

export type PolicyErrorCode =
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'SESSION_SCOPE_MISMATCH'
  | 'USER_INACTIVE'
  | 'ROLE_INVALID'
  | 'POLICY_AUTHORITY_EXCEEDED'
  | 'POLICY_DAILY_AGGREGATE_EXCEEDED'
  | 'FRESH_BIOMETRIC_REQUIRED'
  | 'DEVICE_INVALID'
  | 'COUNTERPARTY_DEACTIVATED'
  | 'ANOMALY_FLAGGED';

export interface PolicyError {
  code: PolicyErrorCode;
  detail?: string;
}

export type PolicyResult =
  | { ok: true; value: PolicyDecision }
  | { ok: false; error: PolicyError };

export interface PolicyDeps {
  validateSessionToken: (token: string) => Promise<{ ok: true; sessionId: string } | { ok: false }>;
  getSession: (sessionId: string) => Promise<PolicySession | null>;
  getUser: (userId: string) => Promise<PolicyUser | null>;
  getCompanyPolicy: (companyId: string) => Promise<CompanyPolicy>;
  getDailyAggregate: (userId: string, dayKey: string) => Promise<number>;
  resolveCounterparty: (address: string) => Promise<PolicyCounterparty | null>;
  checkAnomaly: (input: {
    userId: string;
    velocity: { since: number };
    payload: unknown;
  }) => Promise<{ flagged: boolean }>;
  revokeSession: (sessionId: string, reason: string, by: string) => Promise<void>;
  getEligibleApprovers: (companyId: string, amount: number) => Promise<string[]>;
  now: () => number;
}
