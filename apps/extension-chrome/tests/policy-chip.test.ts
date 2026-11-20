/**
 * PFL-188 regression — the "Company policy" chip must be injected idempotently.
 * The content script re-runs its sweep on every DOM mutation via a
 * MutationObserver; a chip that mutated the DOM on every sweep looped forever
 * and froze Gmail. These tests prove a repeat call makes NO mutation, so a
 * real MutationObserver does not re-fire.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updatePolicyChip } from '../src/content/inject-toolbar.js';
import { setUnsignedPolicy } from '../src/content/send-guard.js';
import { INJECTED_MARKER } from '../src/content/shared.js';

const CHIP = '[data-proofline-policy-chip]';

function makeCompose(): HTMLElement {
  document.body.innerHTML = '';
  const compose = document.createElement('div');
  const toolbar = document.createElement('div');
  const sign = document.createElement('button');
  sign.setAttribute(INJECTED_MARKER, 'true');
  toolbar.appendChild(sign);
  compose.appendChild(toolbar);
  document.body.appendChild(compose);
  return compose;
}

/** Flush the microtask queue so jsdom delivers MutationObserver records. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => setUnsignedPolicy({ mode: 'block', allowOverride: true }));
afterEach(() => setUnsignedPolicy({ mode: 'allow', allowOverride: true }));

describe('updatePolicyChip idempotency (no observer feedback loop)', () => {
  it('injects the chip once and makes NO DOM mutation on a repeat call', async () => {
    const compose = makeCompose();

    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(compose, { childList: true, subtree: true, characterData: true });

    updatePolicyChip(compose);           // first call — creates the chip
    await flush();
    expect(compose.querySelectorAll(CHIP)).toHaveLength(1);
    expect(mutations).toBeGreaterThan(0);

    mutations = 0;
    updatePolicyChip(compose);           // repeat — must be a no-op
    updatePolicyChip(compose);
    await flush();
    expect(mutations).toBe(0);           // the observer did NOT re-fire
    expect(compose.querySelectorAll(CHIP)).toHaveLength(1);

    observer.disconnect();
  });

  it('updates text in place only when the policy message changes', async () => {
    const compose = makeCompose();
    updatePolicyChip(compose);
    const chip = compose.querySelector<HTMLElement>(CHIP)!;
    expect(chip.textContent).toMatch(/signing required/);

    setUnsignedPolicy({ mode: 'warn', allowOverride: true });
    updatePolicyChip(compose);
    expect(compose.querySelectorAll(CHIP)).toHaveLength(1);
    expect(compose.querySelector<HTMLElement>(CHIP)!.textContent).toMatch(/signing recommended/);
  });

  it('removes the chip under allow policy and then no-ops', async () => {
    const compose = makeCompose();
    updatePolicyChip(compose);
    expect(compose.querySelector(CHIP)).not.toBeNull();

    setUnsignedPolicy({ mode: 'allow', allowOverride: true });
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(compose, { childList: true, subtree: true });

    updatePolicyChip(compose);           // removes the chip (one mutation)
    await flush();
    expect(compose.querySelector(CHIP)).toBeNull();

    mutations = 0;
    updatePolicyChip(compose);           // nothing to remove — no mutation
    await flush();
    expect(mutations).toBe(0);
    observer.disconnect();
  });
});
