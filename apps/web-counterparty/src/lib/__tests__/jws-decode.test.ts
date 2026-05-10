import { describe, it, expect } from 'vitest';
import { decodeCosignJws, isExpired } from '../jws-decode';

const NOW_SEC = 1_700_000_000;

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJws(claims: Record<string, unknown>, sig = 'SIG'): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(claims));
  return `${header}.${body}.${sig}`;
}

describe('decodeCosignJws', () => {
  it('decodes a 3-part JWS into claims', () => {
    const jws = makeJws({
      iss: 'acme-title',
      sub: 'msg-123',
      payloadHash: 'aabb',
      iat: NOW_SEC - 60,
      exp: NOW_SEC + 1800,
    });
    const out = decodeCosignJws(jws);
    expect(out).not.toBeNull();
    expect(out!.iss).toBe('acme-title');
    expect(out!.sub).toBe('msg-123');
    expect(out!.payloadHash).toBe('aabb');
    expect(out!.iat).toBe(NOW_SEC - 60);
    expect(out!.exp).toBe(NOW_SEC + 1800);
  });

  it('rejects malformed JWS with wrong segment count', () => {
    expect(decodeCosignJws('only.two')).toBeNull();
    expect(decodeCosignJws('one.two.three.four')).toBeNull();
    expect(decodeCosignJws('')).toBeNull();
  });

  it('rejects invalid base64url body', () => {
    expect(decodeCosignJws('header.@@@invalid@@@.sig')).toBeNull();
  });

  it('extracts known claims (messageId via sub, payloadHash, exp)', () => {
    const jws = makeJws({
      iss: 'co-1',
      sub: 'message-id-x',
      payloadHash: 'deadbeef',
      iat: 1,
      exp: 2,
      kid: 'key-id-7',
    });
    const out = decodeCosignJws(jws)!;
    expect(out.sub).toBe('message-id-x');
    expect(out.payloadHash).toBe('deadbeef');
    expect(out.exp).toBe(2);
    expect(out.kid).toBe('key-id-7');
  });

  it('rejects body whose JSON is missing required claims', () => {
    const jws = makeJws({ iss: 'x' });
    expect(decodeCosignJws(jws)).toBeNull();
  });
});

describe('isExpired', () => {
  it('returns true when exp is at or before now', () => {
    const claims = { iss: 'x', sub: 'y', payloadHash: 'z', iat: 0, exp: NOW_SEC };
    expect(isExpired(claims, NOW_SEC)).toBe(true);
    expect(isExpired(claims, NOW_SEC + 1)).toBe(true);
  });

  it('returns false when exp is in the future', () => {
    const claims = { iss: 'x', sub: 'y', payloadHash: 'z', iat: 0, exp: NOW_SEC + 60 };
    expect(isExpired(claims, NOW_SEC)).toBe(false);
  });
});
