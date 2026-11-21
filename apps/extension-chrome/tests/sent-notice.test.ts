/**
 * PFL-190 — the sender-facing "Sent without a ProofLine signature." notice.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { showUnsignedSentNotice } from '../src/content/sent-notice.js';

const NOTICE = '[data-proofline-sent-notice]';

beforeEach(() => { document.body.innerHTML = ''; });

describe('showUnsignedSentNotice', () => {
  it('shows a notice on the document body with the expected message', () => {
    const el = showUnsignedSentNotice({ schedule: () => ({ cancel: () => {} }) });
    expect(document.querySelector(NOTICE)).toBe(el);
    expect(el.textContent).toMatch(/sent without a proofline signature/i);
    // Fixed overlay, not inside any compose.
    expect(el.style.position).toBe('fixed');
    expect(el.parentElement).toBe(document.body);
  });

  it('removes the notice when its timer fires', () => {
    let fire: (() => void) | null = null;
    showUnsignedSentNotice({ schedule: (fn) => { fire = fn; return { cancel: () => {} }; } });
    expect(document.querySelector(NOTICE)).not.toBeNull();
    fire!();
    expect(document.querySelector(NOTICE)).toBeNull();
  });

  it('replaces an existing notice instead of stacking', () => {
    showUnsignedSentNotice({ schedule: () => ({ cancel: () => {} }) });
    showUnsignedSentNotice({ schedule: () => ({ cancel: () => {} }) });
    expect(document.querySelectorAll(NOTICE)).toHaveLength(1);
  });
});
