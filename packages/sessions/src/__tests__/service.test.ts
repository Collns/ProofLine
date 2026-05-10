import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, type CryptoKey } from 'jose';
import {
  makeSessionService,
  type SessionStore,
  type SessionService,
} from '../service.js';
import { makeJoseSigner, makeJoseVerifier } from '../tokens.js';
import { recipientSetHash } from '../recipient-set.js';
import type { SigningSession } from '../types.js';

// Anchor to real wall-clock so the JWT's exp claim (validated against
// real Date.now() inside jose) stays in the future; service-level time
// travel still uses the injected nowRef.
const NOW = Date.now();
const TTL_MS = 15 * 60 * 1000;
const HARD_CAP_MS = 60 * 60 * 1000;

function makeMemoryStore(): SessionStore & { sessions: Map<string, SigningSession> } {
  const sessions = new Map<string, SigningSession>();
  return {
    sessions,
    async create(session) {
      sessions.set(session.sessionId, { ...session });
    },
    async get(sessionId) {
      const s = sessions.get(sessionId);
      return s ? { ...s } : null;
    },
    async update(sessionId, patch) {
      const existing = sessions.get(sessionId);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      sessions.set(sessionId, updated);
      return { ...updated };
    },
    async listActiveByUser(companyId, userId) {
      return Array.from(sessions.values()).filter(
        (s) =>
          s.companyId === companyId &&
          s.status === 'active' &&
          (userId ? s.userId === userId : true),
      );
    },
  };
}

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256');
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
});

interface Harness {
  service: SessionService;
  store: ReturnType<typeof makeMemoryStore>;
  nowRef: { value: number };
  uuidCounter: { value: number };
}

function makeHarness(): Harness {
  const store = makeMemoryStore();
  const nowRef = { value: NOW };
  const uuidCounter = { value: 0 };
  const signer = makeJoseSigner({ privateKey, publicKey });
  const verifier = makeJoseVerifier({ privateKey, publicKey });
  const service = makeSessionService({
    store,
    signer,
    verifier,
    now: () => nowRef.value,
    uuid: () => `sess-${++uuidCounter.value}`,
  });
  return { service, store, nowRef, uuidCounter };
}

const baseOpenInput = () => ({
  userId: 'user-1',
  companyId: 'co-1',
  recipientAddresses: ['vendor@partner.com'],
  deviceCredentialId: 'cred-1',
});

describe('SessionService.open', () => {
  it('creates a session with correct expiresAt and hardCapAt', async () => {
    const h = makeHarness();
    const result = await h.service.open(baseOpenInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.sessionId).toBe('sess-1');
    expect(result.value.session.expiresAt).toBe(NOW + TTL_MS);
    expect(result.value.session.hardCapAt).toBe(NOW + HARD_CAP_MS);
    expect(result.value.session.status).toBe('active');
    expect(result.value.session.signCount).toBe(0);
    expect(result.value.session.recipientSetHash).toBe(
      recipientSetHash(['vendor@partner.com']),
    );
  });

  it('returns a valid signed token whose payload matches the session', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const validated = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.sessionId).toBe(opened.value.session.sessionId);
    }
  });

  it('throws via recipientSetHash when recipientAddresses is empty', async () => {
    const h = makeHarness();
    await expect(
      h.service.open({ ...baseOpenInput(), recipientAddresses: [] }),
    ).rejects.toThrow(/empty toAddresses/);
  });
});

describe('SessionService.validate', () => {
  it('succeeds for an active session with matching scope', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects with SESSION_SCOPE_MISMATCH for a different recipient hash', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: 'not-the-real-hash',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_SCOPE_MISMATCH');
  });

  it('rejects with SESSION_EXPIRED when session.expiresAt is in the past', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    // Mutate the stored session to be expired but not past hardCap
    h.store.sessions.get('sess-1')!.expiresAt = NOW - 1;
    // Advance "now" only a tiny bit so JWT exp claim is still valid
    h.nowRef.value = NOW + 1;
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects with SESSION_REVOKED carrying the revoke reason', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    await h.service.revoke({
      sessionId: 'sess-1',
      revokedBy: 'admin-1',
      reason: 'admin_manual',
    });
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SESSION_REVOKED');
      if (result.error.code === 'SESSION_REVOKED') {
        expect(result.error.reason).toBe('admin_manual');
      }
    }
  });

  it('rejects with SESSION_HARD_CAP_REACHED when past hard cap', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    // Push expiresAt forward so SESSION_EXPIRED doesn't fire first;
    // pull hardCapAt back so we hit the hard-cap branch.
    h.store.sessions.get('sess-1')!.expiresAt = NOW + 10 * 60 * 1000;
    h.store.sessions.get('sess-1')!.hardCapAt = NOW - 1;
    h.nowRef.value = NOW + 1;
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_HARD_CAP_REACHED');
  });

  it('rejects with SESSION_NOT_FOUND for an unknown sessionId', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    h.store.sessions.delete('sess-1');
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('SessionService.extend', () => {
  it('slides expiresAt by the TTL', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    h.nowRef.value = NOW + 5 * 60 * 1000;
    const extended = await h.service.extend('sess-1');
    expect(extended.ok).toBe(true);
    if (extended.ok) {
      expect(extended.value.expiresAt).toBe(h.nowRef.value + TTL_MS);
    }
  });

  it('clamps expiresAt at hardCapAt', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    // Advance to within TTL of hard cap so a slide would overshoot
    h.nowRef.value = NOW + 55 * 60 * 1000;
    const extended = await h.service.extend('sess-1');
    expect(extended.ok).toBe(true);
    if (extended.ok) {
      expect(extended.value.expiresAt).toBe(NOW + HARD_CAP_MS);
    }
  });

  it('increments signCount and updates lastUsedAt', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    h.nowRef.value = NOW + 60_000;
    const extended = await h.service.extend('sess-1');
    expect(extended.ok).toBe(true);
    if (extended.ok) {
      expect(extended.value.signCount).toBe(1);
      expect(extended.value.lastUsedAt).toBe(h.nowRef.value);
    }
  });

  it('returns SESSION_EXPIRED when status is not active', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    h.store.sessions.get('sess-1')!.status = 'expired';
    const result = await h.service.extend('sess-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('SessionService.revoke', () => {
  it('sets status, revokedAt, revokedBy, revokeReason', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    h.nowRef.value = NOW + 30_000;
    const result = await h.service.revoke({
      sessionId: 'sess-1',
      revokedBy: 'admin-1',
      reason: 'device_revoked',
    });
    expect(result.ok).toBe(true);
    const stored = h.store.sessions.get('sess-1')!;
    expect(stored.status).toBe('revoked');
    expect(stored.revokedAt).toBe(NOW + 30_000);
    expect(stored.revokedBy).toBe('admin-1');
    expect(stored.revokeReason).toBe('device_revoked');
  });

  it('subsequent validate returns SESSION_REVOKED with the same reason', async () => {
    const h = makeHarness();
    const opened = await h.service.open(baseOpenInput());
    if (!opened.ok) throw new Error('open failed');
    await h.service.revoke({
      sessionId: 'sess-1',
      revokedBy: 'system',
      reason: 'anomaly_detected',
    });
    const result = await h.service.validate({
      token: opened.value.token,
      recipientSetHash: opened.value.session.recipientSetHash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'SESSION_REVOKED') {
      expect(result.error.reason).toBe('anomaly_detected');
    } else {
      throw new Error('expected SESSION_REVOKED');
    }
  });
});
