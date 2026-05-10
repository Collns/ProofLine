import type { CosignLinkClaims } from '../api/types';

/**
 * Decodes a 3-part JWS (header.payload.signature) into its claims WITHOUT
 * verifying the signature. The cosign deep-link surface trusts the SERVER
 * to validate the signature + `exp` (per F-SIG-09 / ADR-0010); the client
 * only inspects the body to know what to fetch and to compare claimed
 * payloadHash vs. server-recomputed hash.
 *
 * Returns null on any structural failure; the caller surfaces COSIGN_LINK_INVALID.
 */
export function decodeCosignJws(jws: string): CosignLinkClaims | null {
  if (typeof jws !== 'string') return null;

  const parts = jws.split('.');
  if (parts.length !== 3) return null;

  const [, body] = parts;
  if (!body) return null;

  let json: string;
  try {
    json = base64UrlDecodeToString(body);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const c = parsed as Record<string, unknown>;
  if (typeof c.iss !== 'string')         return null;
  if (typeof c.sub !== 'string')         return null;
  if (typeof c.payloadHash !== 'string') return null;
  if (typeof c.iat !== 'number')         return null;
  if (typeof c.exp !== 'number')         return null;

  return {
    iss:         c.iss,
    sub:         c.sub,
    payloadHash: c.payloadHash,
    iat:         c.iat,
    exp:         c.exp,
    kid:         typeof c.kid === 'string' ? c.kid : undefined,
  };
}

/** True if the claim's `exp` (unix seconds) is at or before `nowSeconds`. */
export function isExpired(claims: CosignLinkClaims, nowSeconds: number): boolean {
  return claims.exp <= nowSeconds;
}

// ─── base64url helpers (browser + jsdom safe) ────────────────────────────────

function base64UrlDecodeToString(b64url: string): string {
  // Translate base64url → base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to a multiple of 4 with '='
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) throw new Error('invalid base64url length');

  if (typeof atob === 'function') {
    return atob(b64);
  }
  // Node fallback (used outside a browser environment, e.g., bare vitest).
  const buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (buf) return buf.from(b64, 'base64').toString('utf-8');
  throw new Error('no base64 decoder available');
}
