/**
 * @file sent-notice.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-190 — the sender-facing notice shown right after an UNSIGNED email is
 * sent: "Sent without a ProofLine signature." It appears near Gmail's own
 * "Message sent" toast (bottom-left) and fades after a few seconds.
 *
 * It is anchored to document.body, NOT the compose — the compose closes on
 * send, so a compose-anchored element would vanish instantly. This makes it
 * work identically for every compose surface (new, reply, forward, pop-out).
 */

const NOTICE_ATTR = 'data-proofline-sent-notice';
const DEFAULT_VISIBLE_MS = 5000;

export interface SentNoticeOptions {
  /** Injectable document for tests. */
  doc?: Document;
  /** How long the notice stays before it is removed. */
  visibleMs?: number;
  /** Injectable timer for tests; returns a cancel handle. */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
  message?: string;
}

/**
 * Shows the "sent unsigned" notice. Any notice already on screen is replaced,
 * so rapid consecutive unsigned sends don't stack. Returns the element so
 * tests can assert on it.
 */
export function showUnsignedSentNotice(opts: SentNoticeOptions = {}): HTMLElement {
  const doc = opts.doc ?? document;
  const visibleMs = opts.visibleMs ?? DEFAULT_VISIBLE_MS;
  const message = opts.message ?? 'Sent without a ProofLine signature.';

  // Replace any existing notice so they never pile up.
  doc.querySelectorAll(`[${NOTICE_ATTR}]`).forEach((el) => el.remove());

  const notice = doc.createElement('div');
  notice.setAttribute(NOTICE_ATTR, 'true');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.textContent = message;
  notice.style.cssText = [
    'position:fixed', 'left:24px', 'bottom:24px', 'z-index:2147483647',
    'max-width:320px', 'padding:12px 16px', 'border-radius:8px',
    'background:#202124', 'color:#FFFFFF',
    'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'box-shadow:0 2px 10px rgba(0,0,0,0.3)', 'pointer-events:none',
  ].join(';');
  doc.body.appendChild(notice);

  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => {
      const h = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(h) };
    });
  schedule(() => notice.remove(), visibleMs);

  return notice;
}
