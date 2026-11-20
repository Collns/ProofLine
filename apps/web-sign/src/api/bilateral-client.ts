// PFL-182 — /v1/bilateral/* client for the counterparty ceremony on web-sign.
// Authorised by the signed bilateral deep-link token (not the extension token).

const DEFAULT_API_BASE = 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const API_BASE = (
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE
).replace(/\/$/, '');

export type CountersignFailureCode =
  | 'BILATERAL_LINK_EXPIRED'
  | 'BILATERAL_LINK_INVALID'
  | 'ALREADY_SIGNED'
  | 'REVOKED'
  | 'WRONG_STATUS'
  | 'NOT_FOUND'
  | 'ASSERTION_INVALID'
  | 'NETWORK_ERROR';

export type CountersignContext =
  | {
      ok: true;
      docId: string;
      docType: string;
      drafterCompanyId: string;
      counterpartyCompanyId: string;
      payload: unknown;
      payloadHash: string;
      challenge: string;
      expiresAt: number;
    }
  | { ok: false; code: CountersignFailureCode; detail: string };

export type CountersignResult =
  | { docId: string; status: 'BILATERAL_SIGNED' }
  | { ok: false; code: CountersignFailureCode; detail: string };

export function getCountersignContext(docId: string, token: string): Promise<CountersignContext> {
  return call<CountersignContext>(
    `${API_BASE}/v1/bilateral/${encodeURIComponent(docId)}/countersign-context?token=${encodeURIComponent(token)}`,
    { headers: { Accept: 'application/json' } },
    (body) => typeof body === 'object' && body !== null && 'ok' in body,
  );
}

export async function submitCountersign(
  docId: string,
  token: string,
  body: {
    challenge: string;
    assertion: { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } };
  },
): Promise<CountersignResult> {
  try {
    const res = await fetch(`${API_BASE}/v1/bilateral/sign-as-counterparty`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-ProofLine-Bilateral-Token': token,
      },
      body: JSON.stringify({ docId, ...body }),
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && parsed && parsed['status'] === 'BILATERAL_SIGNED') {
      return { docId, status: 'BILATERAL_SIGNED' };
    }
    const code = typeof parsed?.['code'] === 'string' ? (parsed['code'] as CountersignFailureCode) : 'ASSERTION_INVALID';
    const detail = typeof parsed?.['detail'] === 'string' ? (parsed['detail'] as string) : `Server returned ${res.status}`;
    return { ok: false, code, detail };
  } catch (err) {
    return { ok: false, code: 'NETWORK_ERROR', detail: (err as Error).message };
  }
}

async function call<T>(url: string, init: RequestInit, isValid: (b: unknown) => boolean): Promise<T> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as T | null;
    if (body && isValid(body)) return body;
    return { ok: false, code: 'NETWORK_ERROR', detail: `Unexpected response (${res.status})` } as unknown as T;
  } catch (err) {
    return { ok: false, code: 'NETWORK_ERROR', detail: (err as Error).message } as unknown as T;
  }
}
