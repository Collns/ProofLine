import { describe, it, expect } from 'vitest';
import { RoleCredential } from '../role-credential.js';

const base = {
  v: 1,
  credentialId: 'cred_abc',
  publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
  userId: 'u_1',
  companyId: 'co_1',
  role: 'manager',
  perEmailLimitUsd: 10000,
  dailyLimitUsd: 50000,
  issuedAt: 1700000000,
  issuerSig: 'MEYCIQDsig',
};

describe('RoleCredential', () => {
  it('accepts a valid credential', () => {
    expect(() => RoleCredential.parse(base)).not.toThrow();
  });
  it('defaults revokedAt to null', () => {
    const result = RoleCredential.parse(base);
    expect(result.revokedAt).toBeNull();
  });
  it('accepts null limits', () => {
    expect(() => RoleCredential.parse({ ...base, perEmailLimitUsd: null, dailyLimitUsd: null })).not.toThrow();
  });
  it('rejects invalid role', () => {
    expect(() => RoleCredential.parse({ ...base, role: 'superadmin' })).toThrow();
  });
  it('rejects negative limit', () => {
    expect(() => RoleCredential.parse({ ...base, perEmailLimitUsd: -1 })).toThrow();
  });
});
