import type { ChallengeRecord, ChallengeStore } from './types.js';

export class InMemoryChallengeStore implements ChallengeStore {
  private readonly map = new Map<string, ChallengeRecord>();

  async put(record: ChallengeRecord): Promise<void> {
    this.map.set(record.challenge, record);
  }

  async get(challenge: string): Promise<ChallengeRecord | null> {
    return this.map.get(challenge) ?? null;
  }

  async consume(challenge: string): Promise<ChallengeRecord | null> {
    const record = this.map.get(challenge);
    if (!record || record.consumed) return null;
    const consumed = { ...record, consumed: true };
    this.map.set(challenge, consumed);
    return consumed;
  }

  async cleanup(now: number): Promise<number> {
    let count = 0;
    for (const [key, record] of this.map) {
      if (record.expiresAt < now) {
        this.map.delete(key);
        count++;
      }
    }
    return count;
  }
}
