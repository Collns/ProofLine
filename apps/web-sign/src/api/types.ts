// Wire-format request/response types for /v1/sign, /v1/sign-silent,
// /v1/sign/finalize. Verified against
// packages/types/src/signing.types.ts on main.

import type {
  EmailPayload,
  WebAuthnAssertion,
  WebAuthnChallenge,
  SignedEnvelope,
  PolicyErrorCode,
  SignatureRecord,
} from '@proofline/types';

// ── /v1/sign ─────────────────────────────────────────────────────────────────

export interface SignRequest {
  payload: EmailPayload;
  recipientSetHash: string;       // 64-char hex
  credentialId: string;
  cosignSignatures?: SignatureRecord[];
  freshBiometric: true;
}

export type SignResponse =
  | { ok: true; challenge: WebAuthnChallenge; policyDecision: 'APPROVED' }
  | { ok: true; policyDecision: 'COSIGN_REQUIRED'; approvers: string[] }
  | { ok: false; error: PolicyErrorCode };

// ── /v1/sign-silent ──────────────────────────────────────────────────────────

export interface SignSilentRequest {
  sessionToken: string;           // JWS
  payload: EmailPayload;
  recipientSetHash: string;
  credentialId: string;
}

export type SignSilentResponse =
  | { ok: true; challenge: WebAuthnChallenge }
  | { ok: false; error: PolicyErrorCode };

// ── /v1/sign/finalize ────────────────────────────────────────────────────────

export interface SignFinalizeRequest {
  assertion: WebAuthnAssertion;
  payloadHash: string;            // 64-char hex
  recipientSetHash: string;
  path: 'fresh' | 'silent';
  sessionToken?: string;
}

export type SignFinalizeResponse =
  | { ok: true; envelope: SignedEnvelope; banner: string; sessionToken?: string }
  | { ok: false; error: PolicyErrorCode };

// ── /v1/extension/auth ───────────────────────────────────────────────────────
// Exchanges a Firebase Auth ID token for a 30-day JWS extension token
// (PFL-061). The popup runs Firebase Auth (Google sign-in), POSTs the
// resulting ID token here, and forwards { authToken, credentialId } to
// the extension via the auth_success ceremony reply.

export interface ExtensionAuthRequest {
  idToken: string;
  extInstallId: string;
}

export interface ExtensionAuthResponse {
  authToken: string;
  userId: string;
  companyId: string;
  credentialId: string;
  email: string;
}

// ── Error envelope ───────────────────────────────────────────────────────────

export interface ApiErrorBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Result helper ────────────────────────────────────────────────────────────

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
