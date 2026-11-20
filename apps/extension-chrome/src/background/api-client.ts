/**
 * @file api-client.ts
 * @module apps/extension-chrome/src/background
 *
 * Thin fetch wrapper for the extension's server calls. All endpoints
 * documented here live at `${CONFIG.apiOrigin}` and require a Bearer
 * token from auth-token.ts.
 *
 * Important: in the current PFL-044 split, the *web-sign popup* makes
 * the /v1/sign and /v1/sign/finalize calls itself — see
 * apps/web-sign/src/routes/SignStart.tsx. The extension launches the
 * popup with the canonical payload + extToken, the popup runs the
 * server round-trip locally. So the launcher does NOT call these
 * endpoints during the active signing flow.
 *
 * These wrappers exist for direct extension-side calls in adjacent
 * flows (cosign-orchestration polling, server-driven session checks,
 * future inline-flow refactors) and to keep the contract typed in one
 * place. All requests:
 *   - Bear `Authorization: Bearer <auth-token>` (caller supplies; we
 *     fail fast with AUTH_REQUIRED if no token is set).
 *   - Send/expect `application/json`.
 *   - Surface server errors as `ApiError` with the server's error code
 *     when present.
 */

import type {
  EmailPayload,
  SignedEnvelope,
  WebAuthnAssertion,
  WebAuthnChallenge,
  PolicyErrorCode,
  UnsignedEmailPolicy,
} from "@proofline/types";

import { CONFIG } from "../shared/config.js";
import { getAuthToken } from "./auth-token.js";

// ─── Request/response shapes (mirror apps/web-sign/src/api/types.ts) ─────────

export interface SignRequestBody {
  payload:          EmailPayload;
  recipientSetHash: string;
  credentialId:     string;
  freshBiometric:   true;
}

export type SignResponse =
  | { ok: true;  challenge: WebAuthnChallenge; policyDecision: "APPROVED" }
  | { ok: true;  policyDecision: "COSIGN_REQUIRED"; approvers: string[] }
  | { ok: false; error: PolicyErrorCode };

export interface SignSilentRequestBody {
  sessionToken:     string;
  payload:          EmailPayload;
  recipientSetHash: string;
  credentialId:     string;
}

export type SignSilentResponse =
  | { ok: true;  challenge: WebAuthnChallenge }
  | { ok: false; error: PolicyErrorCode };

export interface SignFinalizeRequestBody {
  assertion:        WebAuthnAssertion;
  payloadHash:      string;
  recipientSetHash: string;
  path:             "fresh" | "silent";
  sessionToken?:    string;
}

export type SignFinalizeResponse =
  | { ok: true;  envelope: SignedEnvelope; banner: string; sessionToken?: string }
  | { ok: false; error: PolicyErrorCode };

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly code:       string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorBody {
  type?:   string;
  title?:  string;
  status?: number;
  detail?: string;
  error?:  { code: string; message: string };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function callSignFresh(input: {
  payload:          EmailPayload;
  recipientSetHash: string;
  credentialId:     string;
}): Promise<SignResponse> {
  const body: SignRequestBody = {
    payload:          input.payload,
    recipientSetHash: input.recipientSetHash,
    credentialId:     input.credentialId,
    freshBiometric:   true,
  };
  return await postJson<SignRequestBody, SignResponse>("/v1/sign", body);
}

export async function callSignSilent(input: {
  sessionToken:     string;
  payload:          EmailPayload;
  recipientSetHash: string;
  credentialId:     string;
}): Promise<SignSilentResponse> {
  const body: SignSilentRequestBody = {
    sessionToken:     input.sessionToken,
    payload:          input.payload,
    recipientSetHash: input.recipientSetHash,
    credentialId:     input.credentialId,
  };
  return await postJson<SignSilentRequestBody, SignSilentResponse>(
    "/v1/sign-silent",
    body,
  );
}

export async function callSignFinalize(input: {
  assertion:        WebAuthnAssertion;
  payloadHash:      string;
  recipientSetHash: string;
  path:             "fresh" | "silent";
  sessionToken?:    string;
  challengeId:      string;
}): Promise<SignFinalizeResponse> {
  const body: SignFinalizeRequestBody = {
    assertion:        input.assertion,
    payloadHash:      input.payloadHash,
    recipientSetHash: input.recipientSetHash,
    path:             input.path,
    sessionToken:     input.sessionToken,
  };
  return await postJsonWithHeaders<SignFinalizeRequestBody, SignFinalizeResponse>(
    "/v1/sign/finalize",
    body,
    { "X-Proofline-Challenge-Id": input.challengeId },
  );
}

/** PFL-136: progress of a wire waiting for a cosigner. */
export interface SignStatus {
  envelopeId:     string;
  status:         "SIGNED" | "PENDING_COSIGN" | "COSIGNED";
  signatureCount: number;
  linkExpiresAt?: number;
  /** Rendered two-signer banner, present once COSIGNED. */
  banner?:        string;
}

export async function getSignStatus(envelopeId: string): Promise<SignStatus> {
  const auth = await authHeader();
  const response = await fetch(
    `${CONFIG.apiOrigin}/v1/sign/status/${encodeURIComponent(envelopeId)}`,
    { headers: { Accept: "application/json", ...auth } },
  );
  if (!response.ok) {
    throw new ApiError(`HTTP_${response.status}`, response.status, `Status request failed (${response.status})`);
  }
  return (await response.json()) as SignStatus;
}

// ─── PFL-188: unsigned-email policy ───────────────────────────────────────────

/** Fetches the caller company's unsigned-email policy. Throws ApiError on
 *  any failure so the caller can fail CLOSED (treat as block, no override). */
export async function getCompanyPolicy(): Promise<UnsignedEmailPolicy> {
  const auth = await authHeader();
  const response = await fetch(`${CONFIG.apiOrigin}/v1/extension/policy`, {
    headers: { Accept: "application/json", ...auth },
  });
  if (!response.ok) {
    throw new ApiError(`HTTP_${response.status}`, response.status, `Policy request failed (${response.status})`);
  }
  const body = (await response.json()) as { ok?: boolean; policy?: UnsignedEmailPolicy };
  if (!body?.ok || !body.policy) {
    throw new ApiError("POLICY_UNAVAILABLE", 502, "Policy response malformed");
  }
  return body.policy;
}

/** Records a "send unsigned" override for the admin audit log (PFL-188). The
 *  server stamps user/company/timestamp from the auth token. Best-effort. */
export async function postUnsignedOverrideAudit(input: {
  recipientSetHash: string;
  composeType: string;
  policyMode: string;
}): Promise<void> {
  await postJson("/v1/extension/unsigned-override", input);
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function authHeader(): Promise<Record<string, string>> {
  const record = await getAuthToken();
  if (!record) {
    throw new ApiError(
      "AUTH_REQUIRED",
      401,
      "No extension auth token available. Run /extension/auth first.",
    );
  }
  return { Authorization: `Bearer ${record.token}` };
}

async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  return await postJsonWithHeaders<TReq, TRes>(path, body, {});
}

async function postJsonWithHeaders<TReq, TRes>(
  path: string,
  body: TReq,
  extraHeaders: Record<string, string>,
): Promise<TRes> {
  const auth = await authHeader();
  const response = await fetch(`${CONFIG.apiOrigin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept:         "application/json",
      ...auth,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | undefined;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      /* not json — fall through */
    }
    const code =
      errBody?.error?.code ??
      errBody?.title ??
      errBody?.type?.split("/").pop() ??
      `HTTP_${response.status}`;
    const message =
      errBody?.error?.message ??
      errBody?.detail ??
      `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }
  return (await response.json()) as TRes;
}
