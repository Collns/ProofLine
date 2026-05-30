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

// challengeId is the pending_challenges/{id} document key issued by the
// server. The popup must echo it back as the X-ProofLine-Challenge-Id
// REQUEST header on /v1/sign/finalize so the server can locate and
// consume the matching record. (It's also set as a response header for
// older callers, but cross-origin fetch can't read custom headers
// without CORS exposure — so we rely on the body field.)
export type SignResponse =
  | { ok: true; challenge: WebAuthnChallenge; policyDecision: 'APPROVED'; challengeId: string }
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
  | { ok: true; challenge: WebAuthnChallenge; challengeId: string }
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

// ── /v1/extension/register-credential ────────────────────────────────────────
// Enrols a freshly-created WebAuthn credential under the authenticated
// user (PFL-069). Auth: Bearer authToken from /v1/extension/auth.

export interface RegisterCredentialRequest {
  credentialId:      string; // base64url(rawId)
  publicKey:         string; // base64url(SPKI bytes)
  attestationObject: string; // base64url(attestationObject)
  clientDataJSON:    string; // base64url(clientDataJSON)
  deviceName?:       string;
}

export interface RegisterCredentialResponse {
  ok:           true;
  credentialId: string;
}

// ── /v1/auth/challenge ──────────────────────────────────────────────────────
// PFL-095: server-issued WebAuthn registration challenge. The popup MUST
// call this immediately before navigator.credentials.create() and pass
// `challenge` into the WebAuthn options. The same value gets surfaced
// back in clientDataJSON, where /v1/extension/register-credential reads
// it and consumes the matching pending_challenges record (single-use).

export interface RegistrationChallengeRequest {
  /** Optional pre-binding. Usually omitted — the browser doesn't know
   *  the credentialId until after credentials.create resolves. */
  credentialId?: string;
}

export interface RegistrationChallengeResponse {
  challengeId: string;
  challenge:   string; // base64url
  expiresAt:   number; // ms epoch
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
