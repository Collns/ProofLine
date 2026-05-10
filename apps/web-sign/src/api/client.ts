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
  type ApiErrorBody,
} from './types';

// Production: https://api.proofline.app (or per-env override).
// In dev, we default to '' so fetch hits the same origin (Vite proxy
// can forward /v1/* to the Firebase emulator if the operator sets one
// up). Override at runtime with VITE_API_BASE.
const API_BASE = ((import.meta.env?.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

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

// ── Extension auth (client-side stub) ────────────────────────────────────────
// TODO(PFL-AUTH-LOGIN): replace with real fetch to /v1/extension/auth once
// the server ships that endpoint. Today we just synthesize a token for the
// install-flow demo; the extension treats it as opaque.

export async function stubExtensionAuth(
  input: ExtensionAuthRequest,
): Promise<ExtensionAuthResponse> {
  await new Promise((r) => setTimeout(r, 600));
  return {
    ok: true,
    extToken: `dev.${input.extInstallId}.${Math.random().toString(36).slice(2, 12)}`,
    userId: 'dev-user',
    companyId: 'dev-company',
  };
}
