import { describe, it, expect } from 'vitest';
import { checkPayloadIntegrity, checkFreshness } from '../checks.js';
import { buildScenario, buildEnvelope, makeEmailPayload, makeBilateralPayload, hashPayload } from './helpers.js';
import type { Hex32 } from '../types.js';

// We need to access internal check functions directly to unit-test them.
// checkFreshness and checkPayloadIntegrity are exported.
// For bilateral policy we test through verifyEnvelope (covered in verify.test.ts).

const ANCHOR_ROOT = '0xdeadbeef' as Hex32;

describe('checkPayloadIntegrity', () => {
  it('returns ok for matching hash', async () => {
    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    const result = await checkPayloadIntegrity(envelope);
    expect(result.ok).toBe(true);
  });

  it('fails for mismatched hash', async () => {
    const payload = makeEmailPayload();
    const tamperedPayload = { ...payload, subject: 'DIFFERENT' };
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    // Hash is correct for `payload`, but we swap in `tamperedPayload`
    const tampered = { ...envelope, payload: tamperedPayload };
    const result = await checkPayloadIntegrity(tampered as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PAYLOAD_HASH_MISMATCH');
  });
});

describe('checkFreshness', () => {
  it('returns ok for unexpired payload', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload();  // expiresAt = now + 3600
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    const result = await checkFreshness(envelope, s.registry, Date.now());
    expect(result.ok).toBe(true);
  });

  it('fails for expired payload', async () => {
    const s = buildScenario();
    const pastSec = Math.floor(Date.now() / 1000) - 1;
    const payload = makeEmailPayload({ expiresAt: pastSec });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    const result = await checkFreshness(envelope, s.registry, Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PAYLOAD_EXPIRED');
  });

  it('fails for replayed nonce', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ nonce: 'nonce-seen-before-xxxxx' });
    s.registry.addNonce('nonce-seen-before-xxxxx');
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    const result = await checkFreshness(envelope, s.registry, Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NONCE_REPLAYED');
  });

  it('skips freshness checks for wire payload (no expiresAt/nonce)', async () => {
    const s = buildScenario();
    const payload = { v: 1 as const, amount: 1000, currency: 'USD' as const, recipientAccount: '1234', recipientRouting: '021000021' };
    const envelope = buildEnvelope({
      payload,
      payloadType: 'wire',
      signerSpecs: [],
      anchorRoot: ANCHOR_ROOT,
    });
    const result = await checkFreshness(envelope, s.registry, Date.now());
    expect(result.ok).toBe(true);
  });
});
