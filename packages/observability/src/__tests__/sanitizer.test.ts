import { describe, it, expect } from 'vitest';
import { sanitizeForLogging } from '../sanitizer.js';

describe('sanitizeForLogging — string redaction', () => {
  it('redacts an email address inside a string', () => {
    const out = sanitizeForLogging('contact alice@example.com for info');
    expect(out).toBe('contact [REDACTED:EMAIL] for info');
  });

  it('redacts a 9-digit routing number', () => {
    const out = sanitizeForLogging('routing is 021000021 today');
    expect(out).toBe('routing is [REDACTED:ROUTING] today');
  });

  it('redacts a 12-digit account number', () => {
    const out = sanitizeForLogging('account 123456789012 settled');
    expect(out).toBe('account [REDACTED:ACCOUNT] settled');
  });

  it('redacts a JWS-shaped token', () => {
    const jws =
      'eyJhbGciOiJFUzI1NiJ9AAAA.eyJzdWIiOiIxMjM0NTY3ODkwIn0AAAA.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = sanitizeForLogging(`token=${jws} end`) as string;
    expect(out).toContain('[REDACTED:JWT]');
    expect(out).not.toContain(jws);
  });
});

describe('sanitizeForLogging — object key redaction', () => {
  it('redacts a top-level `signature` key regardless of value type', () => {
    const out = sanitizeForLogging({
      signature: { foo: 'bar', n: 42 },
      other: 'visible',
    });
    expect(out).toEqual({ signature: '[REDACTED]', other: 'visible' });
  });

  it('redacts a nested `signature` key while preserving outer structure', () => {
    const out = sanitizeForLogging({ a: { b: { signature: 'x', keep: 'me' } } });
    expect(out).toEqual({ a: { b: { signature: '[REDACTED]', keep: 'me' } } });
  });

  it('redacts emails inside arrays of objects', () => {
    const out = sanitizeForLogging([{ email: 'a@b.com' }, { email: 'c@d.org' }]);
    expect(out).toEqual([
      { email: '[REDACTED:EMAIL]' },
      { email: '[REDACTED:EMAIL]' },
    ]);
  });

  it('preserves numeric, boolean, and null primitives untouched', () => {
    const out = sanitizeForLogging({ n: 42, ok: true, missing: null, off: false });
    expect(out).toEqual({ n: 42, ok: true, missing: null, off: false });
  });

  it('redacts payload + signatures in a SignedEnvelope-shaped object, preserves identifiers', () => {
    const env = {
      companyId: 'co_123',
      credentialId: 'cred_abc',
      canonicalPayload: '{"amount":100,"to":"alice@example.com"}',
      payload: { amount: 100 },
      signatures: [{ alg: 'ES256', sig: 'AAAA' }],
      timestamp: 1700000000000,
    };
    const out = sanitizeForLogging(env);
    expect(out).toEqual({
      companyId: 'co_123',
      credentialId: 'cred_abc',
      canonicalPayload: '[REDACTED]',
      payload: '[REDACTED]',
      signatures: '[REDACTED]',
      timestamp: 1700000000000,
    });
  });

  it('redacts both a `signature` key and an email in a sibling field in one pass', () => {
    const out = sanitizeForLogging({
      signature: 'abc123',
      contact: 'reach me at bob@vendor.com',
    });
    expect(out).toEqual({
      signature: '[REDACTED]',
      contact: 'reach me at [REDACTED:EMAIL]',
    });
  });
});
