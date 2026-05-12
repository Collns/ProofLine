import {
  ApiError,
  type SignRequest,
  type SignResponse,
  type SignSilentRequest,
  type SignSilentResponse,
  type SignFinalizeRequest,
  type SignFinalizeResponse,
  type ExtensionAuthRequest,
  type ExtensionAuthResponse,
  type RegisterCredentialRequest,
  type RegisterCredentialResponse,
  type ApiErrorBody,
} from './types';

// Default to the deployed Firebase Functions origin. Override at build
// time with VITE_API_BASE for emulator runs or per-env staging URLs.
// Trailing slashes get stripped so callers can concatenate `/v1/...`
// without producing `//v1/...`.
const DEFAULT_API_BASE = 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const API_BASE = (
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE
).replace(/\/$/, '');

// Auth: Bearer extension auth token. The popup receives this token from
// the extension via URL param so it can call /v1/sign* on behalf of the
// user. The token is short-lived and bound to the extInstallId.
//
// TODO(PFL-AUTH-LOGIN): tighten this once /v1/extension/auth ships and
// we have a canonical token issuance flow.
let extTokenForRequests: string | null = null;

export function setExtensionToken(token: string): void {
  extTokenForRequests = token;
}

function authHeaders(): Record<string, string> {
  if (!extTokenForRequests) return {};
  return { Authorization: `Bearer ${extTokenForRequests}` };
}

async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const response = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // not json — fall through
    }
    const code = body?.title ?? body?.type?.split('/').pop() ?? `HTTP_${response.status}`;
    const message = body?.detail ?? `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }

  return (await response.json()) as TRes;
}

// ── Endpoint wrappers ────────────────────────────────────────────────────────

export function signFresh(input: SignRequest): Promise<SignResponse> {
  return postJson<SignRequest, SignResponse>('/v1/sign', input);
}

export function signSilent(input: SignSilentRequest): Promise<SignSilentResponse> {
  return postJson<SignSilentRequest, SignSilentResponse>('/v1/sign-silent', input);
}

export function signFinalize(
  input: SignFinalizeRequest,
  challengeId: string,
): Promise<SignFinalizeResponse> {
  // The finalize handler reads x-proofline-challenge-id to bind the assertion
  // to the issued challenge record (see sign-finalize.handler.ts).
  return postJsonWithHeaders<SignFinalizeRequest, SignFinalizeResponse>(
    '/v1/sign/finalize',
    input,
    { 'X-Proofline-Challenge-Id': challengeId },
  );
}

async function postJsonWithHeaders<TReq, TRes>(
  path: string,
  body: TReq,
  extraHeaders: Record<string, string>,
): Promise<TRes> {
  const response = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...authHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // not json — fall through
    }
    const code = body?.title ?? body?.type?.split('/').pop() ?? `HTTP_${response.status}`;
    const message = body?.detail ?? `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }

  return (await response.json()) as TRes;
}

// ── Extension auth ───────────────────────────────────────────────────────────
// POST /v1/extension/auth — exchange a Firebase ID token for a 30-day JWS
// extension auth token. Public endpoint (no Bearer); the Firebase ID
// token in the body IS the auth.

export function requestExtensionAuth(
  input: ExtensionAuthRequest,
): Promise<ExtensionAuthResponse> {
  return postJson<ExtensionAuthRequest, ExtensionAuthResponse>(
    '/v1/extension/auth',
    input,
  );
}

// ── Register WebAuthn credential ─────────────────────────────────────────────
// POST /v1/extension/register-credential — uses the just-issued Bearer
// auth token (PFL-069). Caller MUST setExtensionToken() with the auth
// token before invoking.

export function registerCredential(
  input: RegisterCredentialRequest,
  authToken: string,
): Promise<RegisterCredentialResponse> {
  return postJsonWithHeaders<RegisterCredentialRequest, RegisterCredentialResponse>(
    '/v1/extension/register-credential',
    input,
    { Authorization: `Bearer ${authToken}` },
  );
}
