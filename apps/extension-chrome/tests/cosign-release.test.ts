// @vitest-environment jsdom
/**
 * PFL-136 — held wire is released once the cosigner approves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { watchCosign, COSIGN_ENVELOPE_ATTR, COSIGN_POLL_MS, MAX_WATCH_MS, type CosignWatchDeps } from '../src/content/cosign-release.js';

let clock: number;
let queue: { fn: () => void; at: number }[];

function deps(replies: (string | null)[], overrides: Partial<CosignWatchDeps> = {}): CosignWatchDeps & { checkStatus: ReturnType<typeof vi.fn>; injectBanner: ReturnType<typeof vi.fn>; markSigned: ReturnType<typeof vi.fn> } {
  const checkStatus = vi.fn(async () => {
    const s = replies.shift() ?? 'PENDING_COSIGN';
    return s === null ? null : { status: s, ...(s === 'COSIGNED' ? { bannerHtml: '<div>banner</div>' } : {}) };
  });
  return {
    checkStatus,
    injectBanner: vi.fn(() => ({ ok: true })),
    markSigned: vi.fn(),
    isAttached: (c: Element) => c.isConnected,
    schedule: (fn: () => void, ms: number) => { queue.push({ fn, at: clock + ms }); },
    now: () => clock,
    ...overrides,
  } as never;
}

async function runNext(): Promise<void> {
  const job = queue.shift();
  if (!job) throw new Error('nothing scheduled');
  clock = Math.max(clock, job.at);
  job.fn();
  await new Promise((r) => setTimeout(r, 0));
}

let compose: HTMLElement;
beforeEach(() => {
  clock = 1_000_000;
  queue = [];
  document.body.innerHTML = '';
  compose = document.createElement('div');
  document.body.appendChild(compose);
});

describe('watchCosign', () => {
  it('keeps polling while pending, then inserts the banner and releases Send when cosigned', async () => {
    const d = deps(['PENDING_COSIGN', null, 'COSIGNED']);
    watchCosign(compose, 'env-1', d);
    await runNext(); // pending
    await runNext(); // transient failure
    expect(d.markSigned).not.toHaveBeenCalled();
    await runNext(); // cosigned
    expect(d.checkStatus).toHaveBeenCalledWith('env-1');
    expect(d.injectBanner).toHaveBeenCalledWith(compose, '<div>banner</div>');
    expect(d.markSigned).toHaveBeenCalledWith(compose);
    expect(compose.hasAttribute(COSIGN_ENVELOPE_ATTR)).toBe(false);
    expect(queue).toHaveLength(0);
  });

  it('does not release if the banner could not be inserted', async () => {
    const d = deps(['COSIGNED'], { injectBanner: vi.fn(() => ({ ok: false })) });
    watchCosign(compose, 'env-1', d);
    await runNext();
    expect(d.markSigned).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1); // tries again
  });

  it('stops when the compose closes, a new attempt starts, or the watch times out', async () => {
    const closed = deps([]);
    watchCosign(compose, 'env-1', closed);
    compose.remove();
    await runNext();
    expect(closed.checkStatus).not.toHaveBeenCalled();

    document.body.appendChild(compose);
    const replaced = deps([]);
    watchCosign(compose, 'env-1', replaced);
    compose.setAttribute(COSIGN_ENVELOPE_ATTR, 'env-2');
    await runNext();
    expect(replaced.checkStatus).not.toHaveBeenCalled();

    const old = deps([]);
    watchCosign(compose, 'env-3', old);
    clock += MAX_WATCH_MS;
    await runNext();
    expect(old.checkStatus).not.toHaveBeenCalled();
  });

  it('polls every 10 seconds at first', () => {
    watchCosign(compose, 'env-1', deps([]));
    expect(queue[0]!.at - clock).toBe(COSIGN_POLL_MS);
  });
});
