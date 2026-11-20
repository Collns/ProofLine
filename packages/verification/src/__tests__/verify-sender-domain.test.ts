import { describe, it, expect } from 'vitest';
import { verifyEnvelope } from '../verify.js';
import { buildScenario, buildEnvelope, makeEmailPayload } from './helpers.js';
import type { Hex32 } from '../types.js';

const ANCHOR_ROOT = '0xdeadbeef' as Hex32;

// PFL-187 — the signed From address must bind to the signer company's
// verified domain (or an allowed alias). A mismatch is a suspected spoof.

function envelopeFrom(s: ReturnType<typeof buildScenario>, from: string) {
  const payload = makeEmailPayload({ companyId: 'company-a', from });
  return buildEnvelope({
    payload,
    payloadType: 'email',
    signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
    anchorRoot: ANCHOR_ROOT,
  });
}

describe('sender-domain binding', () => {
  it('verifies when From is on the company verified domain', async () => {
    const s = buildScenario();
    const result = await verifyEnvelope({ envelope: envelopeFrom(s, 'alice@company-a.com'), registry: s.registry });
    expect(result.ok && result.state).toBe('verified');
  });

  it('flags suspected_spoof when From is a different domain (Acme signed from gmail.com)', async () => {
    const s = buildScenario();
    const result = await verifyEnvelope({ envelope: envelopeFrom(s, 'danievwe@gmail.com'), registry: s.registry });
    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'suspected_spoof') {
      expect(result.claimedCompany.domain).toBe('company-a.com');
      expect(result.detail).toMatch(/gmail\.com|verified domain/);
    } else {
      throw new Error(`expected suspected_spoof, got ${JSON.stringify(result)}`);
    }
  });

  it('verifies when From is on an explicitly allowed alias domain', async () => {
    const s = buildScenario();
    s.registry.addCompany({ ...s.companyA, allowedFromDomains: ['gmail.com'] });
    const result = await verifyEnvelope({ envelope: envelopeFrom(s, 'danievwe@gmail.com'), registry: s.registry });
    expect(result.ok && result.state).toBe('verified');
  });

  it('verifies when From is an explicitly allowed exact address', async () => {
    const s = buildScenario();
    s.registry.addCompany({ ...s.companyA, allowedFromAddresses: ['danievwe@gmail.com'] });
    const result = await verifyEnvelope({ envelope: envelopeFrom(s, 'danievwe@gmail.com'), registry: s.registry });
    expect(result.ok && result.state).toBe('verified');
  });

  it('skips the binding for a test company and marks the result testCompany', async () => {
    const s = buildScenario();
    s.registry.addCompany({ ...s.companyA, testCompany: true });
    const result = await verifyEnvelope({ envelope: envelopeFrom(s, 'danievwe@gmail.com'), registry: s.registry });
    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'verified') {
      expect(result.testCompany).toBe(true);
    } else {
      throw new Error(`expected verified test company, got ${JSON.stringify(result)}`);
    }
  });
});
