import { describe, it, expect } from 'vitest';
import { recipientSetHash } from '../recipient-set.js';

describe('recipientSetHash', () => {
  it('produces a deterministic hash for a single address', () => {
    const a = recipientSetHash(['alice@acme.com']);
    const b = recipientSetHash(['alice@acme.com']);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is invariant to input order (sorted-set semantics)', () => {
    const a = recipientSetHash(['a@x.com', 'b@x.com', 'c@x.com']);
    const b = recipientSetHash(['c@x.com', 'a@x.com', 'b@x.com']);
    expect(a).toBe(b);
  });

  it('normalizes whitespace and case', () => {
    const a = recipientSetHash(['  Mark@X.com  ']);
    const b = recipientSetHash(['mark@x.com']);
    expect(a).toBe(b);
  });

  it('produces different hashes for different recipient sets', () => {
    const a = recipientSetHash(['alice@acme.com']);
    const b = recipientSetHash(['bob@acme.com']);
    expect(a).not.toBe(b);
  });

  it('throws on empty array', () => {
    expect(() => recipientSetHash([])).toThrow(/empty toAddresses/);
  });
});
