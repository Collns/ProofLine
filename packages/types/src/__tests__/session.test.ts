import { describe, it, expect } from 'vitest';
import { SessionToken } from '../session.js';

const base = {
  v: 1,
  sessionId: 'sess_abc',
  userId: 'u_1',
  companyId: 'co_1',
  recipientScope: 'abc123hash',
  iat: 1700000000,
  exp: 1700003600,
};

describe('SessionToken', () => {
  it('accepts a valid session token', () => {
    expect(() => SessionToken.parse(base)).not.toThrow();
  });
  it('rejects missing sessionId', () => {
    const { sessionId: _, ...rest } = base;
    expect(() => SessionToken.parse(rest)).toThrow();
  });
  it('rejects non-integer iat', () => {
    expect(() => SessionToken.parse({ ...base, iat: 1700000000.5 })).toThrow();
  });
  it('inferred type has correct shape', () => {
    const result = SessionToken.parse(base);
    expect(typeof result.sessionId).toBe('string');
    expect(typeof result.iat).toBe('number');
  });
});
