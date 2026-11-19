// PFL-136 — /v1/cosign/* client for the approval page. These endpoints are
// authorised by the signed cosign link token, not the extension token.

import type { EmailPayload } from '@proofline/types';

const DEFAULT_API_BASE = 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const API_BASE = (
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE
).replace(/\/$/, '');

export interface CosignSigner {
  userId: string;
  userDisplayName: string;
  companyId: string;
  companyDomain: string;
  companyLegalName: string;
  signedAt: number;
}

export type CosignFailureCode =
  | 'COSIGN_LINK_EXPIRED'
  | 'COSIGN_LINK_INVALID'
  | 'ALREADY_COSIGNED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'ASSERTION_INVALID'
  | 'COSIGNER_NOT_ALLOWED'
  | 'NETWORK_ERROR';

export type CosignContext =
  | {
      ok: true;
      messageId: string;
      payloadHash: string;
      payloadType: 'wire' | 'email' | 'bilateral';
      payload: EmailPayload;
      signer: CosignSigner;
      expiresAt: number;
      cosignChallenge: string;
    }
  | { ok: false; code: CosignFailureCode; detail: string };

export type CosignResult =
  | { ok: true; messageId: string; anchorWillFollow: boolean }
  | { ok: false; code: CosignFailureCode; detail: string };

export type RefreshResult =
  | { ok: true; freshLinkSent: boolean }
  | { ok: false; code: CosignFailureCode; detail: string };

async function call<T extends { ok: boolean }>(url: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as T | null;
    if (body && typeof body === 'object' && 'ok' in body) return body;
    return { ok: false, code: 'NETWORK_ERROR', detail: `Unexpected response (${res.status})` } as unknown as T;
  } catch (err) {
    return { ok: false, code: 'NETWORK_ERROR', detail: (err as Error).message } as unknown as T;
  }
}

export function getCosignContext(messageId: string, token: string): Promise<CosignContext> {
  return call<CosignContext>(
    `${API_BASE}/v1/cosign/${encodeURIComponent(messageId)}?token=${encodeURIComponent(token)}`,
    { headers: { Accept: 'application/json' } },
  );
}

export function submitCosign(
  messageId: string,
  token: string,
  body: {
    challenge: string;
    assertion: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } };
  },
): Promise<CosignResult> {
  return call<CosignResult>(`${API_BASE}/v1/cosign/${encodeURIComponent(messageId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-ProofLine-Cosign-Token': token },
    body: JSON.stringify(body),
  });
}

export function requestFreshCosignLink(messageId: string, token: string): Promise<RefreshResult> {
  return call<RefreshResult>(`${API_BASE}/v1/cosign/${encodeURIComponent(messageId)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
  });
}
