import { describe, it, expect } from 'vitest';
import { makeStubCryptoProvider } from '../providers/stub.js';
import { sha256 } from '../hash.js';
import { randomBytes } from '../random.js';

describe('makeStubCryptoProvider', () => {
  it('roundtrip: sign then verify returns true', async () => {
    const provider = makeStubCryptoProvider();
    const { handle, publicKey } = provider.generateKeyPair();
    const message = new TextEncoder().encode('hello proofline');
    const sig = await provider.sign(handle, message);
    const ok = await provider.verify(publicKey, message, sig);
    expect(ok).toBe(true);
  });

  it('verify with wrong public key returns false', async () => {
    const provider = makeStubCryptoProvider();
    const { handle } = provider.generateKeyPair();
    const { publicKey: wrongKey } = provider.generateKeyPair();
    const message = new TextEncoder().encode('hello proofline');
    const sig = await provider.sign(handle, message);
    const ok = await provider.verify(wrongKey, message, sig);
    expect(ok).toBe(false);
  });

  it('verify with modified message returns false', async () => {
    const provider = makeStubCryptoProvider();
    const { handle, publicKey } = provider.generateKeyPair();
    const message = new TextEncoder().encode('hello proofline');
    const sig = await provider.sign(handle, message);
    const tampered = new TextEncoder().encode('hello proofline!');
    const ok = await provider.verify(publicKey, tampered, sig);
    expect(ok).toBe(false);
  });

  it('verify with modified signature returns false', async () => {
    const provider = makeStubCryptoProvider();
    const { handle, publicKey } = provider.generateKeyPair();
    const message = new TextEncoder().encode('hello proofline');
    const sig = await provider.sign(handle, message);
    // Flip a character at position 8, well inside the r-value of the DER
    // structure (never in the base64url padding zone at the end of the string).
    const pos = 8;
    const replacement = sig[pos] === 'A' ? 'B' : 'A';
    const tampered = sig.slice(0, pos) + replacement + sig.slice(pos + 1);
    const ok = await provider.verify(publicKey, message, tampered);
    expect(ok).toBe(false);
  });
});

describe('sha256', () => {
  it('known vector: sha256 of empty input', () => {
    const result = sha256(new Uint8Array(0));
    const hex = Buffer.from(result).toString('hex');
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns Uint8Array of 32 bytes', () => {
    const result = sha256(new TextEncoder().encode('test'));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });
});

describe('randomBytes', () => {
  it('returns exactly N bytes', () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(32).length).toBe(32);
  });

  it('output is not all zeros', () => {
    const bytes = randomBytes(32);
    // (1/256)^32 probability of false positive
    expect(bytes.every(b => b === 0)).toBe(false);
  });
});
