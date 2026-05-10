import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { makeJoseSigner, makeJoseVerifier } from '../tokens.js';
import type { SessionTokenPayload } from '../types.js';

const ISS = 'proofline';
const ALG = 'ES256';

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair(ALG);
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
  const other = await generateKeyPair(ALG);
  otherPrivateKey = other.privateKey;
});

function payload(overrides: Partial<SessionTokenPayload> = {}): SessionTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    sessionId: 'sess-1',
    userId: 'user-1',
    companyId: 'co-1',
    recipientSetHash: 'hash-1',
    iat: now,
    exp: now + 60,
    ...overrides,
  };
}

describe('jose signer/verifier', () => {
  it('roundtrips a signed payload', async () => {
    const signer = makeJoseSigner({ privateKey, publicKey });
    const verifier = makeJoseVerifier({ privateKey, publicKey });
    const p = payload();
    const token = await signer.sign(p);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe(p.sessionId);
      expect(result.value.userId).toBe(p.userId);
      expect(result.value.companyId).toBe(p.companyId);
      expect(result.value.recipientSetHash).toBe(p.recipientSetHash);
      expect(result.value.v).toBe(1);
    }
  });

  it('returns TOKEN_EXPIRED for expired token', async () => {
    const signer = makeJoseSigner({ privateKey, publicKey });
    const verifier = makeJoseVerifier({ privateKey, publicKey });
    const now = Math.floor(Date.now() / 1000);
    const token = await signer.sign(payload({ iat: now - 120, exp: now - 60 }));
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns TOKEN_INVALID_SIG when signed with different key', async () => {
    const wrongSigner = makeJoseSigner({
      privateKey: otherPrivateKey,
      publicKey,
    });
    const verifier = makeJoseVerifier({ privateKey, publicKey });
    const token = await wrongSigner.sign(payload());
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOKEN_INVALID_SIG');
  });

  it('returns TOKEN_MALFORMED for garbage input', async () => {
    const verifier = makeJoseVerifier({ privateKey, publicKey });
    const result = await verifier.verify('not.a.jwt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOKEN_MALFORMED');
  });

  it('returns TOKEN_MALFORMED when payload fails zod parse', async () => {
    // Sign a token with a payload missing required fields to trip zod
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ v: 1, foo: 'bar' })
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISS)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const verifier = makeJoseVerifier({ privateKey, publicKey });
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOKEN_MALFORMED');
  });
});
