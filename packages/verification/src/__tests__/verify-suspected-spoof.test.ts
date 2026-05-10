import { describe, it, expect } from 'vitest';
import { verifyEnvelope } from '../verify.js';
import {
  buildScenario,
  buildEnvelope,
  makeEmailPayload,
  hashPayload,
  signBytes,
} from './helpers.js';
import type { Hex32 } from '../types.js';

const ANCHOR_ROOT = '0xdeadbeef' as Hex32;

describe('verifyEnvelope — suspected_spoof', () => {
  it('still returns verified when signature is valid against a verified company (no regression)', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('verified');
  });

  it('returns suspected_spoof carrying claimedCompany when signature is invalid for a verified-domain signer', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });
    // Signer identity resolves to verified company-a, but sig is over garbage bytes.
    const badSig = signBytes(s.userAKp.privateKey, new Uint8Array(32).fill(0));
    const tampered = {
      ...envelope,
      signers: [{ ...envelope.signers[0], sig: badSig }],
    };

    const result = await verifyEnvelope({ envelope: tampered as never, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'suspected_spoof') {
      expect(result.claimedCompany.companyId).toBe('company-a');
      expect(result.claimedCompany.domain).toBe('company-a.com');
      expect(result.claimedCompany.legalName).toBe('Company A Inc.');
      expect(typeof result.detail).toBe('string');
    } else {
      throw new Error(`expected suspected_spoof, got ${JSON.stringify(result)}`);
    }
  });

  it('returns rejected with CREDENTIAL_UNKNOWN (not suspected_spoof) when signer identity does not resolve', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{
        userId: 'user-a',
        credentialId: 'cred-does-not-exist',
        privateKey: s.userAKp.privateKey,
      }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe('rejected');
      expect(result.code).toBe('CREDENTIAL_UNKNOWN');
    }
  });

  it('returns rejected with PAYLOAD_HASH_MISMATCH when payloadHash is tampered (suspected_spoof must not swallow earlier failures)', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });
    const tampered = {
      ...envelope,
      payloadHash: hashPayload({ ...payload, body: 'tampered after signing' }),
    };

    const result = await verifyEnvelope({ envelope: tampered as never, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe('rejected');
      expect(result.code).toBe('PAYLOAD_HASH_MISMATCH');
    }
  });
});
