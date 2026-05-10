import { describe, it, expect } from 'vitest';
import { WirePayload } from '../wire.js';

describe('WirePayload', () => {
  it('accepts a valid payload', () => {
    const valid = { v: 1, amount: 50000, currency: 'USD',
      recipientAccount: '••••5678', recipientRouting: '021000021' };
    expect(() => WirePayload.parse(valid)).not.toThrow();
  });
  it('rejects negative amount', () => {
    const invalid = { v: 1, amount: -100, currency: 'USD',
      recipientAccount: '••••5678', recipientRouting: '021000021' };
    expect(() => WirePayload.parse(invalid)).toThrow();
  });
  it('rejects wrong currency', () => {
    const invalid = { v: 1, amount: 100, currency: 'EUR',
      recipientAccount: '••••5678', recipientRouting: '021000021' };
    expect(() => WirePayload.parse(invalid)).toThrow();
  });
  it('rejects routing number shorter than 9 digits', () => {
    const invalid = { v: 1, amount: 100, currency: 'USD',
      recipientAccount: '••••5678', recipientRouting: '12345' };
    expect(() => WirePayload.parse(invalid)).toThrow();
  });
  it('accepts optional memo', () => {
    const valid = { v: 1, amount: 100, currency: 'USD',
      recipientAccount: '1234', recipientRouting: '021000021',
      memo: 'Invoice 42' };
    expect(() => WirePayload.parse(valid)).not.toThrow();
  });
});
