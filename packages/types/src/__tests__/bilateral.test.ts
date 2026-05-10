import { describe, it, expect } from 'vitest';
import { BilateralPayload } from '../bilateral.js';

const base = {
  v: 1,
  docId: 'doc_1',
  docType: 'banking_change',
  drafterCompanyId: 'co_1',
  counterpartyCompanyId: 'co_2',
  content: { accountNumber: '****1234' },
  issuedAt: 1700000000,
  expiresAt: 1700003600,
  nonce: 'aaaabbbbccccddddeeeeff',
};

describe('BilateralPayload', () => {
  it('accepts a valid payload', () => {
    expect(() => BilateralPayload.parse(base)).not.toThrow();
  });
  it('rejects unknown docType', () => {
    expect(() => BilateralPayload.parse({ ...base, docType: 'unknown' })).toThrow();
  });
  it('rejects nonce shorter than 22 chars', () => {
    expect(() => BilateralPayload.parse({ ...base, nonce: 'tooshort' })).toThrow();
  });
  it('accepts all valid docType values', () => {
    for (const docType of ['banking_change', 'vendor_onboarding', 'payment_terms']) {
      expect(() => BilateralPayload.parse({ ...base, docType })).not.toThrow();
    }
  });
});
