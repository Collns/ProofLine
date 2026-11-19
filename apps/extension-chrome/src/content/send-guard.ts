/**
 * @file send-guard.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-096 — stop Gmail from sending a message unsigned when ProofLine
 * signing was attempted and did not complete, or when the message is
 * marked as a wire instruction and isn't signed yet.
 *
 * How it works:
 *   - Each compose carries a sign state in `data-proofline-sign-state`:
 *       pending         Sign clicked, result not back yet
 *       failed          the sign flow failed / was cancelled
 *       cosign_pending  policy requires a cosigner first
 *       signed          banner injected; the message may be sent
 *   - Capture-phase listeners on the document intercept Gmail's Send
 *     button (mousedown / mouseup / click) and Ctrl/Cmd+Enter inside a
 *     compose before Gmail's own handlers run.
 *   - A blocked send shows an inline alert with "Retry signing" and
 *     "Send unsigned". Send unsigned is an explicit, logged choice that
 *     allows the next Send for that compose only.
 *
 * Composes where signing was never attempted (and that aren't wires)
 * are not touched.
 */

import { warn } from '../shared/log.js';
import { INJECTED_MARKER } from './shared.js';

export type SignState = 'pending' | 'failed' | 'cosign_pending' | 'signed';

export const SIGN_STATE_ATTR    = 'data-proofline-sign-state';
export const SEND_UNSIGNED_ATTR = 'data-proofline-send-unsigned';
export const SEND_ALERT_ATTR    = 'data-proofline-send-alert';
const WIRE_CHECKBOX_SELECTOR    = '[data-proofline-wire-checkbox]';

export interface SendGuardDeps {
  /** Returns the compose containers currently on the page. */
  findComposes: (root: ParentNode) => Element[];
  /** Called when the user explicitly sends unsigned (for audit logging). */
  onSendUnsigned?: (compose: Element) => void;
}

// ─── State ───────────────────────────────────────────────────────────────────

export function setSignState(compose: Element, state: SignState): void {
  compose.setAttribute(SIGN_STATE_ATTR, state);
  if (state !== 'failed' && state !== 'cosign_pending') {
    compose.removeAttribute(SEND_UNSIGNED_ATTR);
  }
  if (state === 'signed') clearSendAlert(compose);
}

export function getSignState(compose: Element): SignState | null {
  return (compose.getAttribute(SIGN_STATE_ATTR) as SignState | null) ?? null;
}

function isWire(compose: Element): boolean {
  return compose.querySelector<HTMLInputElement>(WIRE_CHECKBOX_SELECTOR)?.checked === true;
}

/** Why sending is blocked for this compose, or null when it may be sent. */
export function sendBlockReason(compose: Element): string | null {
  if (compose.getAttribute(SEND_UNSIGNED_ATTR) === 'true') return null;
  const state = getSignState(compose);
  if (state === 'signed') return null;
  if (state === 'pending') return 'ProofLine is still signing this email.';
  if (state === 'failed') return 'ProofLine signing failed, so this email is not signed.';
  if (state === 'cosign_pending') return 'This wire needs a cosigner before it can be sent.';
  if (isWire(compose)) return 'This email is marked as a wire instruction and has not been signed.';
  return null;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** Gmail's Send button: role=button whose tooltip / label starts with "Send". */
export function isGmailSendButton(el: Element | null): boolean {
  const btn = el?.closest('[role="button"]');
  if (!btn || btn.hasAttribute(INJECTED_MARKER)) return false;
  const label = (btn.getAttribute('data-tooltip') ?? btn.getAttribute('aria-label') ?? '').trim();
  return /^send\b/i.test(label);
}

function composeFor(target: Element, deps: SendGuardDeps): Element | null {
  return deps.findComposes(document).find((c) => c.contains(target)) ?? null;
}

// ─── Alert UI ────────────────────────────────────────────────────────────────

function clearSendAlert(compose: Element): void {
  compose.querySelector(`[${SEND_ALERT_ATTR}]`)?.remove();
}

function showSendAlert(compose: Element, reason: string, deps: SendGuardDeps): void {
  clearSendAlert(compose);
  const alert = document.createElement('div');
  alert.setAttribute(SEND_ALERT_ATTR, 'true');
  alert.setAttribute('role', 'alert');
  alert.style.cssText = [
    'display:flex', 'gap:8px', 'align-items:center', 'flex-wrap:wrap',
    'margin:6px 0', 'padding:8px 10px', 'border-radius:6px',
    'background:#FDECEA', 'color:#B3261E', 'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = `${reason} Gmail send was blocked.`;
  alert.appendChild(text);

  const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
  if (signBtn) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry signing';
    retry.setAttribute('data-proofline-retry-sign', 'true');
    retry.addEventListener('click', (e) => {
      e.preventDefault();
      clearSendAlert(compose);
      signBtn.click();
    });
    alert.appendChild(retry);
  }

  // Always offered (also while pending) so a lost sign result can never
  // trap the user; it is an explicit, logged choice.
  {
    const unsigned = document.createElement('button');
    unsigned.type = 'button';
    unsigned.textContent = 'Send unsigned';
    unsigned.setAttribute('data-proofline-send-unsigned-btn', 'true');
    unsigned.addEventListener('click', (e) => {
      e.preventDefault();
      compose.setAttribute(SEND_UNSIGNED_ATTR, 'true');
      warn('content', 'user chose to send unsigned', getSignState(compose));
      deps.onSendUnsigned?.(compose);
      text.textContent = 'Click Send again to send this email without a ProofLine signature.';
      unsigned.remove();
    });
    alert.appendChild(unsigned);
  }

  const toolbarRow = signBtn?.parentElement;
  (toolbarRow?.parentElement ?? compose).insertBefore(alert, toolbarRow ?? null);
}

// ─── Install ─────────────────────────────────────────────────────────────────

function block(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/**
 * Installs the capture-phase listeners. Returns an uninstall function.
 */
export function installSendGuard(doc: Document, deps: SendGuardDeps): () => void {
  const onPointer = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // Track Sign clicks so a later Send knows signing is in flight.
    const signBtn = target.closest(`[${INJECTED_MARKER}="true"]`);
    if (signBtn && event.type === 'click') {
      const compose = composeFor(signBtn, deps);
      if (compose) setSignState(compose, 'pending');
      return;
    }

    if (!isGmailSendButton(target)) return;
    const compose = composeFor(target, deps);
    if (!compose) return;
    const reason = sendBlockReason(compose);
    if (!reason) {
      // A one-time "send unsigned" choice is consumed by this send.
      if (event.type === 'click') compose.removeAttribute(SEND_UNSIGNED_ATTR);
      return;
    }
    block(event);
    if (event.type === 'click') showSendAlert(compose, reason, deps);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const compose = composeFor(target, deps);
    if (!compose) return;
    const reason = sendBlockReason(compose);
    if (!reason) {
      compose.removeAttribute(SEND_UNSIGNED_ATTR);
      return;
    }
    block(event);
    showSendAlert(compose, reason, deps);
  };

  const pointerEvents = ['mousedown', 'mouseup', 'click'] as const;
  for (const type of pointerEvents) doc.addEventListener(type, onPointer, true);
  doc.addEventListener('keydown', onKeydown, true);

  return () => {
    for (const type of pointerEvents) doc.removeEventListener(type, onPointer, true);
    doc.removeEventListener('keydown', onKeydown, true);
  };
}
