import type {
  CosignContextResponse,
  FinalizeCosignResponse,
  RefreshLinkResponse,
  CosignAssertionPayload,
} from './types';
import { FIXTURES, fixtureFinalizeOk, fixtureRefreshOk } from './fixtures';

const API_BASE = '/v1/cosign';

interface ClientOpts {
  /** Override transport mode (defaults: fixtures in DEV, live elsewhere). */
  mode?: 'live' | 'fixtures';
  /** Window override for tests. */
  window?: Pick<Window, 'location'>;
}

function resolveMode(opts?: ClientOpts): 'live' | 'fixtures' {
  if (opts?.mode) return opts.mode;
  // import.meta.env is provided by vitest/vite; default safely if absent.
  const envDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  return envDev ? 'fixtures' : 'live';
}

function readFixtureKey(opts?: ClientOpts): string | null {
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
