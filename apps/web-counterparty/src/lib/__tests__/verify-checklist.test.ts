import { describe, it, expect } from 'vitest';
import type { CosignContextResponse } from '../../api/types';
import { runVerifyChecklist, STEP_ORDER } from '../verify-checklist';

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJws(claims: Record<string, unknown>, sig = 'SIG'): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(claims));
  return `${header}.${body}.${sig}`;
}

const NOW_SEC = 1_700_000_000;
// Fixed hash that matches `payload` below — `sha256HexFake` returns this for any input.
const HASH_GOOD = 'aaaa1111';
const HASH_TAMP = 'bbbb2222';

const happyContext: CosignContextResponse = {
  ok: true,
  messageId: 'msg-1',
  envelope: {
    v: 1,
    payloadType: 'wire',
    payload: { v: 1, amount: 100, currency: 'USD', recipientAccount: '1234', recipientRouting: '021000021' },
    payloadHash: HASH_GOOD,
    signers: [{ userId: 'u1', credentialId: 'c1', role: 'manager', sig: 's', signedAt: 0, sessionId: null }],
    anchorRoot: null,
    anchorTxHash: null,
    anchorBlockNumber: null,
  },
  payloadHash: HASH_GOOD,
  payloadType: 'wire',
  payload: { v: 1, amount: 100, currency: 'USD', recipientAccount: '1234', recipientRouting: '021000021' },
  signer: {
    userId: 'u1',
    credentialId: 'c1',
    signedAt: 0,
    userDisplayName: 'Sarah Chen',
    companyId: 'acme',
    companyDomain: 'acme.com',
    companyLegalName: 'Acme',
  },
  expiresAt: NOW_SEC + 1800,
  cosignChallenge: 'chal',
};

const tamperedContext: CosignContextResponse = {
  ...happyContext,
  payloadHash: HASH_TAMP,                            // server stores a different hash
  envelope: { ...happyContext.envelope, payloadHash: HASH_TAMP },
};

const sha256HexFake = async (_bytes: Uint8Array) => HASH_GOOD;

describe('runVerifyChecklist', () => {
  it('passes all 6 steps on the happy path', async () => {
    const jws = makeJws({
      iss: 'acme', sub: 'msg-1', payloadHash: HASH_GOOD,
      iat: NOW_SEC - 60, exp: NOW_SEC + 1800,
    });
    const out = await runVerifyChecklist({
      jws,
      context: happyContext,
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,
    });
    expect(out.allPassed).toBe(true);
    expect(out.failedAt).toBe(-1);
    expect(out.steps).toHaveLength(STEP_ORDER.length);
    expect(out.steps.every((s) => s.status === 'passed')).toBe(true);
  });

  it('fails Step 4 on a tampered fixture (server hash != claimed)', async () => {
    const jws = makeJws({
      iss: 'acme', sub: 'msg-1', payloadHash: HASH_GOOD,    // claim says good
      iat: NOW_SEC - 60, exp: NOW_SEC + 1800,
    });
    const out = await runVerifyChecklist({
      jws,
      context: tamperedContext,                              // server stores HASH_TAMP
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,                              // recompute → HASH_GOOD
    });
    expect(out.allPassed).toBe(false);
    // Step 4 ('hash-match') is index 3 in STEP_ORDER.
    expect(out.failedAt).toBe(3);
    expect(out.steps[3].status).toBe('failed');
    expect(out.steps[3].failureDetail).toBeTruthy();
  });

  it('fails Step 1 (decoded → expired) when the JWS exp is in the past', async () => {
    const jws = makeJws({
      iss: 'acme', sub: 'msg-1', payloadHash: HASH_GOOD,
      iat: NOW_SEC - 60 * 60, exp: NOW_SEC - 60,
    });
    const out = await runVerifyChecklist({
      jws,
      context: happyContext,
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,
    });
    expect(out.allPassed).toBe(false);
    expect(out.failedAt).toBe(0);
    expect(out.steps[0].status).toBe('failed');
  });

  it('exposes step index via onStep so the UI can animate', async () => {
    const jws = makeJws({
      iss: 'acme', sub: 'msg-1', payloadHash: HASH_GOOD,
      iat: NOW_SEC - 60, exp: NOW_SEC + 1800,
    });
    const observed: number[] = [];
    await runVerifyChecklist({
      jws,
      context: happyContext,
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,
      onStep: (_step, index) => {
        observed.push(index);
      },
    });
    // Each step transitions running → passed (2 callbacks per step).
    const uniq = Array.from(new Set(observed)).sort((a, b) => a - b);
    expect(uniq).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('halts at first failure and does not run later steps', async () => {
    const jws = 'malformed';                                 // Step 1 fails
    const out = await runVerifyChecklist({
      jws,
      context: happyContext,
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,
    });
    expect(out.allPassed).toBe(false);
    expect(out.failedAt).toBe(0);
    // Steps 2+ remain 'pending' — never advanced.
    expect(out.steps.slice(1).every((s) => s.status === 'pending')).toBe(true);
  });

  it('fails Step 2 when the server returned an error context', async () => {
    const jws = makeJws({
      iss: 'acme', sub: 'msg-1', payloadHash: HASH_GOOD,
      iat: NOW_SEC - 60, exp: NOW_SEC + 1800,
    });
    const errCtx: CosignContextResponse = {
      ok: false, code: 'NOT_FOUND', detail: 'Message not found',
    };
    const out = await runVerifyChecklist({
      jws,
      context: errCtx,
      nowSeconds: NOW_SEC,
      sha256Hex: sha256HexFake,
    });
    expect(out.allPassed).toBe(false);
    expect(out.failedAt).toBe(1);
    expect(out.steps[1].status).toBe('failed');
  });
});
