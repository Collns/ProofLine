/**
 * @file verify-inbound.ts
 * @module apps/extension-chrome/src/background
 *
 * Background service worker handler for inbound email verification
 * (PFL-048, F-EXT-05 / F-VER-09).
 *
 * Receives `VERIFY_INBOUND` messages from the content script, calls
 * GET /v1/verify/{envelopeId} on the ProofLine API, and responds with
 * a `VERIFY_RESULT` message containing the full VerificationResponse.
 *
 * Caching: results are cached in memory (keyed by envelopeId) for the
 * service-worker lifetime. Because MV3 service workers are non-persistent,
 * the cache is effectively per-tab-activation. We do NOT use
 * chrome.storage.local for verification results — they are read-only
 * public data with a 60s CDN cache on the server; freshness is fine.
 *
 * Error handling: network errors and non-200 responses are surfaced as
 * a synthetic `rejected` result so the content script always receives
 * a well-typed response and can render a graceful degradation chip.
 */

import { log, warn } from '../shared/log.js';
import { CONFIG } from '../shared/config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerifyInboundMessage {
  type: 'VERIFY_INBOUND';
  envelopeId: string;
}

export interface VerifyResultMessage {
  type: 'VERIFY_RESULT';
  result: VerificationResponse;
}

/** Shape returned by GET /v1/verify/:id — mirrors apps/functions/src/verify/contract.ts */
export type VerificationResponse =
  | {
      ok: true;
      state: 'verified' | 'bilateral';
      signers: Array<{
        userId: string;
        userDisplayName?: string;
        role?: string;
        companyDomain?: string;
        companyLegalName?: string;
        signedAt?: number;
      }>;
      payload: Record<string, unknown>;
      anchor: {
        root: string;
        blockNumber: string;
        timestamp: string;
      };
    }
  | {
      ok: true;
      state: 'suspected_spoof';
      claimedCompany: {
        companyId: string;
        domain: string;
        legalName: string;
      };
      detail: string;
    }
  | {
      ok: false;
      state: 'rejected';
      code: string;
      detail: string;
    }
  | {
      ok: true;
      state: 'unverified_sender';
    };

// ─── In-memory cache ──────────────────────────────────────────────────────────

const resultCache = new Map<string, VerificationResponse>();

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Call this from the background service worker's `chrome.runtime.onMessage`
 * listener. Returns true if the message was handled (async response pending).
 */
export function handleVerifyInbound(
  message: unknown,
  sendResponse: (response: VerifyResultMessage) => void,
): boolean {
  if (!isVerifyInboundMessage(message)) return false;

  const { envelopeId } = message;

  // Validate envelope ID format: 8-128 url-safe chars
  if (!isValidEnvelopeId(envelopeId)) {
    warn('background', '[verify-inbound] invalid envelopeId format', envelopeId);
    sendResponse({
      type: 'VERIFY_RESULT',
      result: {
        ok: false,
        state: 'rejected',
        code: 'INVALID_ID',
        detail: 'Envelope ID format is invalid.',
      },
    });
    return true;
  }

  // Return cached result immediately if available
  const cached = resultCache.get(envelopeId);
  if (cached) {
    log('background', '[verify-inbound] cache hit', envelopeId);
    sendResponse({ type: 'VERIFY_RESULT', result: cached });
    return true;
  }

  // Fire the async fetch and respond when done.
  fetchVerification(envelopeId)
    .then((result) => {
      resultCache.set(envelopeId, result);
      sendResponse({ type: 'VERIFY_RESULT', result });
    })
    .catch((err: unknown) => {
      warn('background', '[verify-inbound] fetch error', err);
      const errorResult: VerificationResponse = {
        ok: false,
        state: 'rejected',
        code: 'NETWORK_ERROR',
        detail: err instanceof Error ? err.message : 'Unknown network error.',
      };
      sendResponse({ type: 'VERIFY_RESULT', result: errorResult });
    });

  // Return true to signal async response
  return true;
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function fetchVerification(envelopeId: string): Promise<VerificationResponse> {
  const url = `${CONFIG.apiOrigin}/v1/verify/${encodeURIComponent(envelopeId)}`;
  log('background', '[verify-inbound] fetching', url);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
  } catch (e) {
    throw new Error(`Network request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (resp.status === 400) {
    return {
      ok: false,
      state: 'rejected',
      code: 'INVALID_ID',
      detail: 'The server rejected the envelope ID.',
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      state: 'rejected',
      code: `HTTP_${resp.status}`,
      detail: `Verification server responded with ${resp.status}.`,
    };
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return {
      ok: false,
      state: 'rejected',
      code: 'PARSE_ERROR',
      detail: 'Could not parse verification response.',
    };
  }

  return parseVerificationResponse(json);
}

function parseVerificationResponse(raw: unknown): VerificationResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      state: 'rejected',
      code: 'PARSE_ERROR',
      detail: 'Verification response was not a JSON object.',
    };
  }

  const r = raw as Record<string, unknown>;
  const state = r['state'] as string | undefined;

  if (state === 'verified' || state === 'bilateral') {
    return {
      ok: true,
      state,
      signers: (r['signers'] as VerificationResponse extends { signers: infer S } ? S : never) ?? [],
      payload: (r['payload'] as Record<string, unknown>) ?? {},
      anchor: (r['anchor'] as { root: string; blockNumber: string; timestamp: string }) ?? {
        root: '',
        blockNumber: '0',
        timestamp: '0',
      },
    };
  }

  if (state === 'suspected_spoof') {
    return {
      ok: true,
      state: 'suspected_spoof',
      claimedCompany: (r['claimedCompany'] as { companyId: string; domain: string; legalName: string }) ?? {
        companyId: '',
        domain: '',
        legalName: '',
      },
      detail: (r['detail'] as string) ?? '',
    };
  }

  if (state === 'unverified_sender') {
    return { ok: true, state: 'unverified_sender' };
  }

  // rejected or unknown
  return {
    ok: false,
    state: 'rejected',
    code: (r['code'] as string) ?? 'UNKNOWN',
    detail: (r['detail'] as string) ?? '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isVerifyInboundMessage(msg: unknown): msg is VerifyInboundMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>)['type'] === 'VERIFY_INBOUND' &&
    typeof (msg as Record<string, unknown>)['envelopeId'] === 'string'
  );
}

/** Mirrors the server-side isValidVerifyId check: 8-128 url-safe chars. */
function isValidEnvelopeId(id: string): boolean {
  return /^[A-Za-z0-9_\-]{8,128}$/.test(id);
}

/** Exported for tests — flush the in-process cache. */
export function clearVerificationCache(): void {
  resultCache.clear();
}