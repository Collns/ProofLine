/**
 * @file send-guard.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-096 / PFL-181 — stop Gmail from sending a message unsigned when
 * ProofLine signing was attempted and did not complete, or when the message
 * is marked as a wire instruction and isn't signed yet.
 *
 * How it works:
 *   - Each compose carries a sign state in `data-proofline-sign-state`:
 *       pending         Sign clicked, result not back yet
 *       failed          the sign flow failed / was cancelled
 *       cosign_pending  policy requires a cosigner first
 *       signed          banner injected; the message may be sent
 *   - A `signed` compose also stores the content fingerprint it was signed
 *     at (`data-proofline-signed-hash`). If the draft is edited after
 *     signing — or Gmail recycles the compose container for a new message —
 *     the fingerprint no longer matches and Send re-locks (PFL-181 bug 2).
 *   - Capture-phase listeners on the document intercept Gmail's Send button
 *     (mousedown / mouseup / click) and Ctrl/Cmd+Enter inside a compose
 *     before Gmail's own handlers run. The compose is resolved from the
 *     clicked element by climbing to the instrumented container, so inline
 *     reply / forward / pop-out composes are guarded too (PFL-181 bug 1).
 *   - A blocked send shows an inline alert. For a non-wire, "Send unsigned"
 *     is an explicit, logged, one-time escape. Wire instructions are NEVER
 *     escapable: an unsigned wire can never be sent (PFL-181 bug 3).
 *
 * Composes where signing was never attempted (and that aren't wires) are
 * not touched.
 */

import { warn } from '../shared/log.js';
import {
  INJECTED_MARKER,
  isInsideEditable,
  resolveInstrumentedCompose,
} from './shared.js';
import { contentFingerprint } from './compose-content.js';

export type SignState = 'pending' | 'failed' | 'cosign_pending' | 'signed';

export const SIGN_STATE_ATTR    = 'data-proofline-sign-state';
export const SEND_UNSIGNED_ATTR = 'data-proofline-send-unsigned';
export const SEND_ALERT_ATTR    = 'data-proofline-send-alert';
export const SIGNED_HASH_ATTR   = 'data-proofline-signed-hash';
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
  if (state !== 'signed') compose.removeAttribute(SIGNED_HASH_ATTR);
  if (state === 'signed') clearSendAlert(compose);
}

export function getSignState(compose: Element): SignState | null {
  return (compose.getAttribute(SIGN_STATE_ATTR) as SignState | null) ?? null;
}

/**
 * Marks the compose signed AND records the content fingerprint it was signed
 * at, so a later edit (or a recycled container holding a different draft)
 * re-locks Send. Use this instead of `setSignState(compose, 'signed')`.
 */
export function markSigned(compose: Element): void {
  setSignState(compose, 'signed');
  const fp = contentFingerprint(compose);
  if (fp !== null) compose.setAttribute(SIGNED_HASH_ATTR, fp);
}

/**
 * Clears all ProofLine guard state from a compose. Called when a message is
 * actually sent (so Gmail can safely recycle the container for a new draft)
 * and when we first instrument a recycled container.
 */
export function clearComposeGuardState(compose: Element): void {
  compose.removeAttribute(SIGN_STATE_ATTR);
  compose.removeAttribute(SEND_UNSIGNED_ATTR);
  compose.removeAttribute(SIGNED_HASH_ATTR);
  clearSendAlert(compose);
}

function isWire(compose: Element): boolean {
  return compose.querySelector<HTMLInputElement>(WIRE_CHECKBOX_SELECTOR)?.checked === true;
}

/**
 * True when the compose is marked signed but its current content no longer
 * matches what was signed — an edit after signing, or a recycled container.
 * When no fingerprint was recorded we do not re-lock (backward compatible).
 */
export function isStaleSignature(compose: Element): boolean {
  if (getSignState(compose) !== 'signed') return false;
  const stored = compose.getAttribute(SIGNED_HASH_ATTR);
  if (!stored) return false;
  const current = contentFingerprint(compose);
  return current === null || current !== stored;
}

/** Why sending is blocked for this compose, or null when it may be sent. */
export function sendBlockReason(compose: Element): string | null {
  const state = getSignState(compose);
  const wire = isWire(compose);

  if (state === 'signed') {
    return isStaleSignature(compose)
      ? 'This email changed after it was signed. Sign it again before sending.'
      : null;
  }
  if (state === 'cosign_pending') {
    return 'This wire is waiting for a cosigner. ProofLine unblocks Send as soon as an approver cosigns.';
  }
  // An unsigned wire can never be sent — no escape hatch (PFL-181 bug 3).
  if (wire) {
    return 'This email is marked as a wire instruction and must be signed before sending.';
  }
  // Non-wire: a one-time "send unsigned" choice releases exactly one send.
  if (compose.getAttribute(SEND_UNSIGNED_ATTR) === 'true') return null;
  if (state === 'pending') return 'ProofLine is still signing this email.';
  if (state === 'failed') return 'ProofLine signing failed, so this email is not signed.';
  return null;
}

/** Whether the inline alert may offer a "Send unsigned" escape hatch. */
function maySendUnsigned(compose: Element): boolean {
  return !isWire(compose) && getSignState(compose) !== 'cosign_pending';
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
  // Primary: climb to the instrumented container. Works for dialogs AND
  // inline reply/forward boxes, independent of Gmail's DOM differences.
  const resolved = resolveInstrumentedCompose(target);
  if (resolved) return resolved;
  // Fallback: containment search over the detector's current composes.
  return deps.findComposes(document).find((c) => c.contains(target)) ?? null;
}

// ─── Alert UI ────────────────────────────────────────────────────────────────

function clearSendAlert(compose: Element): void {
  compose.querySelector(`[${SEND_ALERT_ATTR}]`)?.remove();
}

/**
 * Finds a safe place to insert ProofLine UI: a parent and a reference node,
 * guaranteed to be OUTSIDE Gmail's editable body so the UI is never
 * serialized into the sent email (PFL-181 bug 3). Prefers the row that holds
 * our Sign button.
 */
function safeAnchor(compose: Element): { parent: Element; before: Node | null } {
  const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
  const toolbarRow = signBtn?.parentElement ?? null;
  const candidate = toolbarRow?.parentElement ?? toolbarRow ?? compose;
  if (!isInsideEditable(candidate)) {
    const before = toolbarRow && candidate.contains(toolbarRow) ? toolbarRow : null;
    return { parent: candidate, before };
  }
  // The preferred anchor is inside an editable region — never insert there.
  // Fall back to placing the UI immediately before the body editable.
  const body = compose.querySelector(
    '[contenteditable="true"], [role="textbox"], [g_editable="true"]',
  );
  if (body?.parentElement && !isInsideEditable(body.parentElement)) {
    return { parent: body.parentElement, before: body };
  }
  return { parent: compose, before: compose.firstChild };
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

  // "Send unsigned" is offered only for a non-wire that isn't waiting on a
  // cosigner: an explicit, logged, one-time choice. A wire instruction is
  // never escapable (PFL-181 bug 3) and the cosign state is known-pending.
  if (maySendUnsigned(compose)) {
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

  const { parent, before } = safeAnchor(compose);
  parent.insertBefore(alert, before);
}

// ─── Install ─────────────────────────────────────────────────────────────────

function block(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/** A send is passing — consume any one-time unsigned choice and, for a
 *  message that was signed, clear the guard state so Gmail may recycle the
 *  container for a fresh draft without it looking pre-signed. */
function onSendAllowed(compose: Element): void {
  compose.removeAttribute(SEND_UNSIGNED_ATTR);
  if (getSignState(compose) === 'signed') clearComposeGuardState(compose);
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
      if (event.type === 'click') onSendAllowed(compose);
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
      onSendAllowed(compose);
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
