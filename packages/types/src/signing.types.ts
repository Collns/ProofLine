import { z } from 'zod';
import { EmailPayload } from './email.js';
import { WirePayload } from './wire.js';
import { SignedEnvelope } from './envelope.js';
import { SessionToken as SessionTokenPayload } from './session.js';

export type { EmailPayload, WirePayload, SignedEnvelope, SessionTokenPayload };

// ─── WebAuthn ─────────────────────────────────────────────────────────────────

export const WebAuthnAssertionSchema = z.object({
  credentialId: z.string().min(1),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
  userHandle: z.string().optional(),
});
export type WebAuthnAssertion = z.infer<typeof WebAuthnAssertionSchema>;

export const WebAuthnChallengeSchema = z.object({
  challenge: z.string().min(1),
  rpId: z.string(),
  allowCredentials: z.array(
    z.object({ type: z.literal('public-key'), id: z.string() })
  ),
  userVerification: z.enum(['required', 'preferred', 'discouraged']),
  timeout: z.number().int().positive(),
});
export type WebAuthnChallenge = z.infer<typeof WebAuthnChallengeSchema>;

// ─── Signature record ─────────────────────────────────────────────────────────

export const SignatureRecordSchema = z.object({
  signerId: z.string().min(1),
  credentialId: z.string().min(1),
  sig: z.string().min(1),
  signedAt: z.number().int(),
  sessionId: z.string().uuid().optional(),
  path: z.enum(['fresh', 'silent']),
});
export type SignatureRecord = z.infer<typeof SignatureRecordSchema>;

// ─── Request / response types ─────────────────────────────────────────────────

export const SignRequestSchema = z.object({
  payload: EmailPayload,
  recipientSetHash: z.string().length(64),
  credentialId: z.string().min(1),
  cosignSignatures: z.array(SignatureRecordSchema).optional(),
  freshBiometric: z.literal(true),
});
export type SignRequest = z.infer<typeof SignRequestSchema>;

export type SignResponse =
  | { ok: true; challenge: WebAuthnChallenge; policyDecision: 'APPROVED' }
  | { ok: true; policyDecision: 'COSIGN_REQUIRED'; approvers: string[] }
  | { ok: false; error: PolicyErrorCode };

export const SignSilentRequestSchema = z.object({
  sessionToken: z.string().min(1),
  payload: EmailPayload,
  recipientSetHash: z.string().length(64),
  credentialId: z.string().min(1),
});
export type SignSilentRequest = z.infer<typeof SignSilentRequestSchema>;

export type SignSilentResponse =
  | { ok: true; challenge: WebAuthnChallenge }
  | { ok: false; error: PolicyErrorCode };

export const SignFinalizeRequestSchema = z.object({
  assertion: WebAuthnAssertionSchema,
  payloadHash: z.string().length(64),
  recipientSetHash: z.string().length(64),
  path: z.enum(['fresh', 'silent']),
  sessionToken: z.string().optional(),
});
export type SignFinalizeRequest = z.infer<typeof SignFinalizeRequestSchema>;

export type SignFinalizeResponse =
  | {
      ok: true;
      envelope: SignedEnvelope;
      banner: string;
      sessionToken?: string;
    }
  | { ok: false; error: PolicyErrorCode };

// ─── Policy types ─────────────────────────────────────────────────────────────

export type PolicyErrorCode =
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'SESSION_SCOPE_MISMATCH'
  | 'USER_INACTIVE'
  | 'ROLE_INVALID'
  | 'DEVICE_INVALID'
  | 'FRESH_BIOMETRIC_REQUIRED'
  | 'HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC'
  | 'COSIGN_REQUIRED'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'POLICY_AUTHORITY_EXCEEDED'
  | 'POLICY_DAILY_AGGREGATE_EXCEEDED'
  | 'POLICY_COUNTERPARTY_DEACTIVATED'
  | 'ANOMALY_FLAGGED'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'ASSERTION_INVALID'
  | 'NONCE_REPLAYED'
  | 'INTERNAL_ERROR';

export type PolicyDecision =
  | { decision: 'APPROVED' }
  | { decision: 'COSIGN_REQUIRED'; approvers: string[] };

export type PolicyError = { code: PolicyErrorCode; detail?: string };

export type PolicyResult =
  | { ok: true; value: PolicyDecision }
  | { ok: false; error: PolicyError };

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface DeviceRecord {
  credentialId: string;
  publicKey: string;
  revokedAt?: number;
  enrolledAt: number;
  // PFL-085: human label set at registration time ("MacBook Pro",
  // "iPhone"). Optional — older docs predate this field.
  deviceName?: string;
  // PFL-085: stamped by sign-finalize after a successful assertion. Lets
  // the admin dashboard show "last used 3 days ago" and lets policy
  // flag dormant devices for revocation review.
  lastUsedAt?: number;
}

export interface UserRecord {
  userId: string;
  companyId: string;
  status: 'active' | 'inactive' | 'suspended';
  role: 'owner' | 'manager' | 'employee';
  wireLimitUsd: number;
  dailyLimitUsd: number;
  devices: DeviceRecord[];
}

export interface SigningSession {
  sessionId: string;
  userId: string;
  companyId: string;
  recipientSetHash: string;
  recipientAddresses: string[];
  authorizedAt: number;
  expiresAt: number;
  hardCapAt: number;
  deviceCredentialId: string;
  status: 'active' | 'expired' | 'revoked';
  revokedAt?: number;
  revokedBy?: string;
  revokeReason?: string;
  lastUsedAt: number;
  signCount: number;
}

export interface CompanyPolicy {
  companyId: string;
  highValueThresholdUsd: number;
  sessionTtlMs: number;
  sessionHardCapMs: number;
  cosignTtlMs: number;
}

export interface CounterpartyRecord {
  email: string;
  companyId: string;
  status: 'active' | 'suspended' | 'deactivated';
}

export interface AnomalyCheckInput {
  userId: string;
  velocity: { since: number };
  payload: EmailPayload;
}

export interface PolicyContext {
  getUser: (userId: string) => Promise<UserRecord | null>;
  getSession: (sessionId: string) => Promise<SigningSession | null>;
  getCompanyPolicy: (companyId: string) => Promise<CompanyPolicy>;
  getDailyAggregate: (userId: string, day: string) => Promise<number>;
  resolveCounterparty: (email: string) => Promise<CounterpartyRecord | null>;
  checkAnomaly: (input: AnomalyCheckInput) => Promise<{ flagged: boolean; reason?: string }>;
  revokeSession: (sessionId: string, reason: string, by: string) => Promise<void>;
  isNonceUsed: (nonce: string) => Promise<boolean>;
  recordNonce: (nonce: string, ttlSeconds: number) => Promise<void>;
  now: () => number;
}