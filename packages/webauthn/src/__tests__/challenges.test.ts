import { describe, it, expect } from 'vitest';
import { InMemoryChallengeStore } from '../challenges.js';
import type { ChallengeRecord } from '../types.js';

function makeRecord(overrides: Partial<ChallengeRecord> = {}): ChallengeRecord {
  const now = Date.now();
  return {
    challenge: 'test-challenge',
    userId: 'user-1',
    purpose: 'registration',
    rpId: 'proofline.app',
    createdAt: now,
    expiresAt: now + 60_000,
    consumed: false,
    ...overrides,
  };
}

describe('InMemoryChallengeStore', () => {
  it('put + get returns record', async () => {
    const store = new InMemoryChallengeStore();
    const record = makeRecord({ challenge: 'abc' });
    await store.put(record);
    const fetched = await store.get('abc');
    expect(fetched).toEqual(record);
  });

  it('get returns null for unknown challenge', async () => {
    const store = new InMemoryChallengeStore();
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('consume marks record consumed and returns it', async () => {
    const store = new InMemoryChallengeStore();
    const record = makeRecord({ challenge: 'consume-me' });
    await store.put(record);
    const result = await store.consume('consume-me');
    expect(result).not.toBeNull();
    expect(result!.consumed).toBe(true);
    // The stored copy is also updated
    const stored = await store.get('consume-me');
    expect(stored!.consumed).toBe(true);
  });

  it('consume returns null on second call (replay protected)', async () => {
    const store = new InMemoryChallengeStore();
    await store.put(makeRecord({ challenge: 'once-only' }));
    const first = await store.consume('once-only');
    expect(first).not.toBeNull();
    const second = await store.consume('once-only');
    expect(second).toBeNull();
  });

  it('consume returns null for unknown challenge', async () => {
    const store = new InMemoryChallengeStore();
    expect(await store.consume('ghost')).toBeNull();
  });

  it('cleanup removes expired records', async () => {
    const store = new InMemoryChallengeStore();
    const past = Date.now() - 1000;
    await store.put(makeRecord({ challenge: 'expired', expiresAt: past }));
    await store.put(makeRecord({ challenge: 'fresh', expiresAt: Date.now() + 60_000 }));

    const removed = await store.cleanup(Date.now());
    expect(removed).toBe(1);
    expect(await store.get('expired')).toBeNull();
    expect(await store.get('fresh')).not.toBeNull();
  });

  it('cleanup returns 0 when nothing is expired', async () => {
    const store = new InMemoryChallengeStore();
    await store.put(makeRecord({ challenge: 'valid', expiresAt: Date.now() + 60_000 }));
    const removed = await store.cleanup(Date.now());
    expect(removed).toBe(0);
  });
});
