import type {
  CosignContextResponse,
  FinalizeCosignResponse,
  RefreshLinkResponse,
  CosignAssertionPayload,
} from './types';
import { FIXTURES, fixtureFinalizeOk, fixtureRefreshOk } from './fixtures';

// Absolute origin of the deployed Firebase Functions `api` HTTP function.
// The counterparty page is hosted on its own subdomain with no /v1/*
// rewrites, so we point straight at the function URL (/v1/cosign/*).
const DEFAULT_API_BASE = 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const API_ORIGIN = (
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE
).replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/v1/cosign`;

interface ClientOpts {
  /** Override transport mode (defaults: fixtures in DEV, live elsewhere). */
  mode?: 'live' | 'fixtures';
  /** Window override for tests. */
  window?: Pick<Window, 'location'>;
}

// PFL-171: fixtures are a dev-server convenience only. Production builds
// always call the API, and a ?fixture= link has no effect there.
function isDev(): boolean {
  return import.meta.env.DEV === true;
}

function resolveMode(opts?: ClientOpts): 'live' | 'fixtures' {
  if (opts?.mode) return opts.mode;
  return isDev() ? 'fixtures' : 'live';
}

function readFixtureKey(opts?: ClientOpts): string | null {
  if (!isDev()) return null;
  const w = opts?.window ?? (typeof window !== 'undefined' ? window : undefined);
  if (!w) return null;
  const params = new URLSearchParams(w.location.search);
  return params.get('fixture');
}

export async function getCosignContext(
  args: { messageId: string; token: string },
  opts?: ClientOpts,
): Promise<CosignContextResponse> {
  const mode       = resolveMode(opts);
  const fixtureKey = readFixtureKey(opts);

  if (mode === 'fixtures' || fixtureKey) {
    const key = fixtureKey ?? 'ready';
    return FIXTURES[key] ?? FIXTURES.ready;
  }

  try {
    const url = `${API_BASE}/${encodeURIComponent(args.messageId)}?token=${encodeURIComponent(args.token)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      // Server-modeled error envelope; if missing, surface as INVALID.
      const body = await res.json().catch(() => null);
      if (body && typeof body === 'object' && 'code' in body) {
        return body as CosignContextResponse;
      }
      return {
        ok: false,
        code: res.status === 404 ? 'NOT_FOUND' : 'COSIGN_LINK_INVALID',
        detail: `Cosign API returned ${res.status}`,
      };
    }
    return (await res.json()) as CosignContextResponse;
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      detail: (err as Error).message,
    };
  }
}

export async function finalizeCosign(
  args: { messageId: string; token: string; payload: CosignAssertionPayload },
  opts?: ClientOpts,
): Promise<FinalizeCosignResponse> {
  const mode       = resolveMode(opts);
  const fixtureKey = readFixtureKey(opts);

  if (mode === 'fixtures' || fixtureKey) {
    return { ...fixtureFinalizeOk, messageId: args.messageId };
  }

  try {
    const url = `${API_BASE}/${encodeURIComponent(args.messageId)}/finalize`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-ProofLine-Cosign-Token': args.token,
      },
      body: JSON.stringify(args.payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body && typeof body === 'object' && 'code' in body) {
        return body as FinalizeCosignResponse;
      }
      return {
        ok: false,
        code: 'POLICY_REJECTED',
        detail: `Finalize API returned ${res.status}`,
      };
    }
    return (await res.json()) as FinalizeCosignResponse;
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      detail: (err as Error).message,
    };
  }
}

export async function requestFreshLink(
  args: { messageId: string; token: string },
  opts?: ClientOpts,
): Promise<RefreshLinkResponse> {
  const mode       = resolveMode(opts);
  const fixtureKey = readFixtureKey(opts);

  if (mode === 'fixtures' || fixtureKey) {
    return fixtureRefreshOk;
  }

  try {
    const url = `${API_BASE}/${encodeURIComponent(args.messageId)}/refresh`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: args.token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body && typeof body === 'object' && 'code' in body) {
        return body as RefreshLinkResponse;
      }
      return {
        ok: false,
        code: 'COSIGN_LINK_INVALID',
        detail: `Refresh API returned ${res.status}`,
      };
    }
    return (await res.json()) as RefreshLinkResponse;
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      detail: (err as Error).message,
    };
  }
}
