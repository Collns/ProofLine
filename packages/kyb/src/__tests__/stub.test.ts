import { describe, it, expect } from 'vitest';
import { makeStubKYBProvider } from '../providers/stub.js';

const noDelay = () => Promise.resolve();

describe('makeStubKYBProvider — verifyBusiness', () => {
  it('returns approved by default for valid EIN', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyBusiness({
      legalName: 'Acme Title',
      ein: '12-3456789',
      state: 'DE',
      country: 'US',
    });
    expect(result.ok).toBe(true);
    expect(result.flags).toHaveLength(0);
    expect(result.officers.length).toBeGreaterThan(0);
  });

  it('returns rejected for EIN starting with "00"', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyBusiness({
      legalName: 'Sketchy LLC',
      ein: '00-1234567',
      state: 'DE',
      country: 'US',
    });
    expect(result.ok).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.flags[0].severity).toBe('high');
    expect(result.officers).toHaveLength(0);
  });

  it('produces deterministic vendorRef for same EIN', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const a = await p.verifyBusiness({
      legalName: 'Acme', ein: '12-3456789', state: 'DE', country: 'US',
    });
    const b = await p.verifyBusiness({
      legalName: 'Different Name', ein: '12-3456789', state: 'CA', country: 'US',
    });
    expect(a.vendorRef).toBe(b.vendorRef);
  });

  it('produces different vendorRef for different EINs', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const a = await p.verifyBusiness({
      legalName: 'A', ein: '12-3456789', state: 'DE', country: 'US',
    });
    const b = await p.verifyBusiness({
      legalName: 'B', ein: '98-7654321', state: 'DE', country: 'US',
    });
    expect(a.vendorRef).not.toBe(b.vendorRef);
  });

  it('approved result has officers, rejected result has none', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const approved = await p.verifyBusiness({
      legalName: 'Acme', ein: '12-3456789', state: 'DE', country: 'US',
    });
    const rejected = await p.verifyBusiness({
      legalName: 'Sketch', ein: '00-1111111', state: 'DE', country: 'US',
    });
    expect(approved.officers.length).toBeGreaterThan(0);
    expect(rejected.officers).toHaveLength(0);
  });

  it('rejected result has high-severity sanctions_match flag', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyBusiness({
      legalName: 'Sketch', ein: '00-1111111', state: 'DE', country: 'US',
    });
    expect(result.flags[0].type).toBe('sanctions_match');
    expect(result.flags[0].severity).toBe('high');
  });

  it('raw field includes simulated: true and provider: "stub"', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyBusiness({
      legalName: 'Acme', ein: '12-3456789', state: 'DE', country: 'US',
    });
    const raw = result.raw as any;
    expect(raw.simulated).toBe(true);
    expect(raw.provider).toBe('stub');
  });

  it('raw.middeskShape mirrors Middesk response structure', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyBusiness({
      legalName: 'Acme Title', ein: '12-3456789', state: 'DE', country: 'US',
    });
    const raw = result.raw as any;
    expect(raw.middeskShape).toHaveProperty('id');
    expect(raw.middeskShape).toHaveProperty('status', 'completed');
    expect(raw.middeskShape).toHaveProperty('review_status', 'approved');
    expect(raw.middeskShape).toHaveProperty('tin');
    expect(raw.middeskShape.tin.tin).toBe('12-3456789');
  });
});

describe('makeStubKYBProvider — verifyOfficer', () => {
  it('returns ok: true for any valid email', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyOfficer({
      email: 'alice@acme.com',
    });
    expect(result.ok).toBe(true);
    expect(result.documentVerified).toBe(true);
    expect(result.livenessConfirmed).toBe(true);
  });

  it('matchedExpected is true when expectedName is provided', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyOfficer({
      email: 'alice@acme.com',
      expectedName: 'Alice Chen',
    });
    expect(result.matchedExpected).toBe(true);
  });

  it('matchedExpected is false when expectedName is omitted', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const result = await p.verifyOfficer({
      email: 'alice@acme.com',
    });
    expect(result.matchedExpected).toBe(false);
  });

  it('produces deterministic vendorRef for same email', async () => {
    const p = makeStubKYBProvider({ delay: noDelay });
    const a = await p.verifyOfficer({ email: 'alice@acme.com' });
    const b = await p.verifyOfficer({ email: 'alice@acme.com' });
    expect(a.vendorRef).toBe(b.vendorRef);
  });
});
