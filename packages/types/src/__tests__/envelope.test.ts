import { describe, it, expect } from 'vitest';
import { SignedEnvelope } from '../envelope.js';

const signer = {
  userId: 'u_1',
  credentialId: 'cred_1',
  role: 'manager',
  sig: 'MEYCIQDsig',
  signedAt: 1700000000,
  sessionId: null,
};

const wirePayload = {
  v: 1,
  amount: 50000,
  currency: 'USD',
  recipientAccount: '••••5678',
  recipientRouting: '021000021',
};

const base = {
  v: 1,
  payloadType: 'wire',
  payload: wirePayload,
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb924',
  signers: [signer],
};

describe('SignedEnvelope', () => {
  it('accepts a valid wire envelope', () => {
    expect(() => SignedEnvelope.parse(base)).not.toThrow();
  });
  it('defaults anchor fields to null', () => {
    const result = SignedEnvelope.parse(base);
    expect(result.anchorRoot).toBeNull();
    expect(result.anchorTxHash).toBeNull();
    expect(result.anchorBlockNumber).toBeNull();
  });
  it('rejects empty signers array', () => {
    expect(() => SignedEnvelope.parse({ ...base, signers: [] })).toThrow();
  });
  it('rejects invalid payloadType', () => {
    expect(() => SignedEnvelope.parse({ ...base, payloadType: 'unknown' })).toThrow();
  });
  it('accepts anchor fields when present', () => {
    const withAnchor = {
      ...base,
      anchorRoot: '0xabc',
      anchorTxHash: '0xdef',
      anchorBlockNumber: 12345,
    };
    expect(() => SignedEnvelope.parse(withAnchor)).not.toThrow();
  });
});
