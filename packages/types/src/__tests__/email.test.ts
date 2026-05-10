import { describe, it, expect } from 'vitest';
import { EmailPayload } from '../email.js';

const base = {
  v: 1,
  from: 'alice@example.com',
  to: ['bob@example.com'],
  subject: 'Wire transfer',
  body: 'Please review.',
  issuedAt: 1700000000,
  expiresAt: 1700003600,
  nonce: 'aaaabbbbccccddddeeeeff',
  companyId: 'co_1',
};

describe('EmailPayload', () => {
  it('accepts a valid payload', () => {
    expect(() => EmailPayload.parse(base)).not.toThrow();
  });
  it('defaults cc/bcc/isWireInstruction', () => {
    const result = EmailPayload.parse(base);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
    expect(result.isWireInstruction).toBe(false);
  });
  it('rejects invalid from address', () => {
    expect(() => EmailPayload.parse({ ...base, from: 'not-an-email' })).toThrow();
  });
  it('rejects empty to array', () => {
    expect(() => EmailPayload.parse({ ...base, to: [] })).toThrow();
  });
  it('rejects nonce shorter than 22 chars', () => {
    expect(() => EmailPayload.parse({ ...base, nonce: 'short' })).toThrow();
  });
});
