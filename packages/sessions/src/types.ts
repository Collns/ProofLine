import { z } from 'zod';

export type SessionStatus = 'active' | 'expired' | 'revoked';

export type SessionRevokeReason =
  | 'admin_manual'
  | 'device_revoked'
  | 'role_changed'
  | 'user_deactivated'
  | 'anomaly_detected'
  | 'hard_cap_reached'
  | 'logout'
  | 'session_replaced';

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
  status: SessionStatus;
  revokedAt?: number;
  revokedBy?: string;
  revokeReason?: SessionRevokeReason;
  lastUsedAt: number;
  signCount: number;
}

export const SessionTokenPayload = z.object({
  v: z.literal(1),
  sessionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  recipientSetHash: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionTokenPayload = z.infer<typeof SessionTokenPayload>;

export type SessionError =
  | { code: 'SESSION_NOT_FOUND' }
  | { code: 'SESSION_EXPIRED' }
  | { code: 'SESSION_REVOKED'; reason: SessionRevokeReason }
  | { code: 'SESSION_SCOPE_MISMATCH' }
  | { code: 'SESSION_HARD_CAP_REACHED' }
  | { code: 'TOKEN_INVALID_SIG' }
  | { code: 'TOKEN_EXPIRED' }
  | { code: 'TOKEN_MALFORMED' }
  | { code: 'INTERNAL'; message: string };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
