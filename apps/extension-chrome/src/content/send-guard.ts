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

import { log } from '../shared/log.js';
import {
  INJECTED_MARKER,
  isInsideEditable,
  resolveInstrumentedCompose,
} from './shared.js';
import { contentFingerprint } from './compose-content.js';
import { insertUnsignedFooter } from './unsigned-footer.js';

export type SignState = 'pending' | 'failed' | 'cosign_pending' | 'signed';

export const SIGN_STATE_ATTR    = 'data-proofline-sign-state';
export const SEND_UNSIGNED_ATTR = 'data-proofline-send-unsigned';
export const SEND_ALERT_ATTR    = 'data-proofline-send-alert';
export const SIGNED_HASH_ATTR   = 'data-proofline-signed-hash';
const WIRE_CHECKBOX_SELECTOR    = '[data-proofline-wire-checkbox]';

export interface SendGuardDeps {
  /** Returns the compose containers currently on the page. */
  findComposes: (root: ParentNode) => Element[];
  /** Called when the user explicitly chooses "Send unsigned" in the alert. */
  onSendUnsigned?: (compose: Element) => void;
  /**
   * PFL-190 — called when an unsigned send actually proceeds: allow mode, the
   * warn-mode confirm, or a block-mode override. `overrode` is true for the
   * confirm/override paths (false for plain allow-mode); `footerAdded` says
   * whether the recipient "sent unsigned" footer was appended to this send.
   */
  onUnsignedSend?: (compose: Element, info: { overrode: boolean; footerAdded: boolean }) => void;
}

// ─── PFL-188: company unsigned-email policy ───────────────────────────────────
//
// Governs a PLAIN unsigned, non-wire email that was never signed. Wires and
// attempted-but-incomplete signs are handled above and are unaffected. The
// content script sets the real policy (company default is block; fail-closed
// is block + no override). The guard's own default is permissive so unit
// tests that don't care about policy behave as before.

export type UnsignedSendMode = 'block' | 'warn' | 'allow';
export interface EffectiveUnsignedPolicy {
  mode: UnsignedSendMode;
  allowOverride: boolean;
  /** True when the policy couldn't be fetched and we're failing closed. */
  failed?: boolean;
  /** PFL-190 — append the recipient "sent unsigned" footer. Default true. */
  appendFooter?: boolean;
}

let unsignedPolicy: EffectiveUnsignedPolicy = { mode: 'allow', allowOverride: true };

/** PFL-190 — the footer is on unless the policy explicitly turns it off. */
function shouldAppendFooter(): boolean {
  return unsignedPolicy.appendFooter !== false;
}

export function setUnsignedPolicy(policy: EffectiveUnsignedPolicy): void {
  unsignedPolicy = policy;
}
export function getUnsignedPolicy(): EffectiveUnsignedPolicy {
  return unsignedPolicy;
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
  endSigning(compose);
  clearSendAlert(compose);
}

// ─── Signing lifecycle: progress + timeout (PFL-181 #2/#3) ───────────────────
//
// The Sign button's own handler calls beginSigning() AFTER the payload
// validates, so a validation failure never leaves the compose looking like it
// is "still signing". While pending we show a visible progress chip and arm a
// timeout: if no result comes back (popup blocked / closed / SW asleep), the
// compose flips to `failed` with a clear reason instead of hanging forever.

export const SIGNING_PROGRESS_ATTR = 'data-proofline-signing-progress';
export const DEFAULT_SIGN_TIMEOUT_MS = 90_000;

interface SigningTimer { cancel: () => void; }
const signingTimers = new WeakMap<Element, SigningTimer>();

export interface BeginSigningOptions {
  timeoutMs?: number;
  /** Injectable scheduler for tests; returns a handle with cancel(). */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

export function beginSigning(compose: Element, opts?: BeginSigningOptions): void {
  endSigning(compose);
  clearSendAlert(compose);
  setSignState(compose, 'pending');
  showSigningProgress(compose);

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS;
  const schedule =
    opts?.schedule ??
    ((fn: () => void, ms: number) => {
      const h = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(h) };
    });
  const timer = schedule(() => {
    if (getSignState(compose) !== 'pending') return;
    setSignState(compose, 'failed');
    removeSigningProgress(compose);
    showSigningFailed(
      compose,
      "ProofLine didn't hear back from the signing popup — it may have been blocked or closed.",
    );
  }, timeoutMs);
  signingTimers.set(compose, timer);
}

/** Cancels the signing timeout and removes the progress chip. */
export function endSigning(compose: Element): void {
  const t = signingTimers.get(compose);
  if (t) { t.cancel(); signingTimers.delete(compose); }
  removeSigningProgress(compose);
}

function showSigningProgress(compose: Element): void {
  removeSigningProgress(compose);
  const chip = document.createElement('div');
  chip.setAttribute(SIGNING_PROGRESS_ATTR, 'true');
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.style.cssText = [
    'display:flex', 'gap:8px', 'align-items:center',
    'margin:6px 0', 'padding:8px 10px', 'border-radius:6px',
    'background:#EFF6FF', 'color:#1E3A8A', 'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');
  chip.textContent = 'Signing with ProofLine… approve in the popup, then return here.';
  const { parent, before } = safeAnchor(compose);
  parent.insertBefore(chip, before);
}

function removeSigningProgress(compose: Element): void {
  compose.querySelector(`[${SIGNING_PROGRESS_ATTR}]`)?.remove();
}

function showSigningFailed(compose: Element, reason: string): void {
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
  text.textContent = reason;
  alert.appendChild(text);
  const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
  if (signBtn) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry signing';
    retry.setAttribute('data-proofline-retry-sign', 'true');
    retry.addEventListener('click', (e) => { e.preventDefault(); clearSendAlert(compose); signBtn.click(); });
    alert.appendChild(retry);
  }
  const { parent, before } = safeAnchor(compose);
  parent.insertBefore(alert, before);
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
  // Plain unsigned email, never signed — governed by the company policy (PFL-188).
  if (unsignedPolicy.mode === 'allow') return null;
  if (unsignedPolicy.mode === 'warn') {
    return "This email isn't signed. Your company asks you to confirm before sending it unsigned.";
  }
  // block — distinguish a genuine policy from failing closed so the user knows why.
  return unsignedPolicy.failed
    ? "Couldn't load your company's signing policy, so sending is blocked until it loads. Reconnect ProofLine (click the extension icon) or try again."
    : 'Your company requires outgoing email to be signed with ProofLine.';
}

/** Whether the inline alert may offer a "Send unsigned" escape hatch. */
function maySendUnsigned(compose: Element): boolean {
  if (isWire(compose)) return false;                              // wires never (PFL-181)
  if (getSignState(compose) === 'cosign_pending') return false;   // cosign is known-pending
  // PFL-188: in block mode the override exists only if the admin allows it;
  // warn always offers the one-click confirm; allow has no block anyway.
  if (unsignedPolicy.mode === 'block') return unsignedPolicy.allowOverride;
  return true;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** Gmail's Send button: role=button whose tooltip / label starts with "Send". */
export function isGmailSendButton(el: Element | null): boolean {
  const btn = el?.closest('[role="button"]');
  if (!btn || btn.hasAttribute(INJECTED_MARKER)) return false;
  const label = (btn.getAttribute('data-tooltip') ?? btn.getAttribute('aria-label') ?? '').trim();
  return /^send\b/i.test(label);
}

/**
 * Programmatically clicks Gmail's own Send button inside a compose. Used by
 * the warn-mode one-click confirm (PFL-190 #2): the synthetic click re-enters
 * the capture-phase guard, which allows it (the override is armed) and then
 * lets Gmail's handler send. No-op if the Send button can't be found.
 */
function triggerGmailSend(compose: Element): void {
  const btn = Array.from(compose.querySelectorAll<HTMLElement>('[role="button"]'))
    .find((b) => isGmailSendButton(b));
  btn?.click();
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

export function clearSendAlert(compose: Element): void {
  compose.querySelector(`[${SEND_ALERT_ATTR}]`)?.remove();
}

/**
 * Finds a safe place to insert ProofLine UI: a parent and a reference node,
 * guaranteed to be OUTSIDE Gmail's editable body so the UI is never
 * serialized into the sent email (PFL-181 bug 3). Prefers the row that holds
 * our Sign button.
 */
function safeAnchor(compose: Element): { parent: Element; before: Node | null } {
  // PFL-181 #4: insert the alert/progress as a BLOCK child of the compose,
  // directly before the toolbar's top-level block. In inline reply/forward
  // the Sign button lives inside a <table> toolbar (tr.btC); inserting a <div>
  // into that table region shifted the toolbar down over the wire panel and
  // hid the "Amount (USD)" label. Anchoring in the compose's own block flow
  // keeps the toolbar intact and the wire panel (also a compose child,
  // appended after) below the toolbar.
  const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
  if (signBtn) {
    // Climb to the highest ancestor of the Sign button that is still a direct
    // child of the compose — the toolbar's top-level block.
    let block: Element = signBtn;
    while (block.parentElement && block.parentElement !== compose) {
      block = block.parentElement;
    }
    if (block.parentElement === compose && !isInsideEditable(block)) {
      return { parent: compose, before: block };
    }
  }
  // Fallback: place the UI immediately before the body editable, outside it.
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
    // Extra right padding + wrapping keeps the buttons clear of Grammarly's
    // floating icon in inline replies (PFL-190 follow-up #3).
    'margin:6px 0', 'padding:8px 36px 8px 10px', 'border-radius:6px',
    'background:#FDECEA', 'color:#B3261E', 'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = `${reason} Gmail send was blocked.`;
  alert.appendChild(text);

  const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
  if (signBtn) {
    const retry = document.createElement('button');
    retry.type = 'button';
    // Never-attempted block/warn reads as "Sign and send"; a prior attempt reads as a retry.
    retry.textContent = getSignState(compose) ? 'Retry signing' : 'Sign and send';
    retry.setAttribute('data-proofline-retry-sign', 'true');
    retry.addEventListener('click', (e) => {
      e.preventDefault();
      clearSendAlert(compose);
      signBtn.click();
    });
    alert.appendChild(retry);
  }

  // The unsigned override: a wire is never escapable (PFL-181) and cosign is
  // known-pending; otherwise it depends on the company policy (PFL-188) —
  // always offered in warn (the one-click confirm), and in block only when
  // the admin allows overrides.
  if (maySendUnsigned(compose)) {
    const unsigned = document.createElement('button');
    unsigned.type = 'button';
    unsigned.textContent = unsignedPolicy.mode === 'warn' ? 'Send without signing' : 'Send unsigned';
    unsigned.setAttribute('data-proofline-send-unsigned-btn', 'true');
    unsigned.addEventListener('click', (e) => {
      e.preventDefault();
      compose.setAttribute(SEND_UNSIGNED_ATTR, 'true');
      // info level, not warn: a deliberate user choice, not an error — Chrome's
      // extension Errors page lists console.warn/error (PFL-190 follow-up).
      log('content', 'user chose to send unsigned', getSignState(compose));
      deps.onSendUnsigned?.(compose);
      if (unsignedPolicy.mode === 'warn') {
        // PFL-190 #2: warn is a ONE-CLICK confirm — send immediately. The
        // programmatic Send click flows back through the guard, which now
        // allows it (override armed), appends the footer, fires onUnsignedSend
        // (notice + audit), then Gmail's own handler sends.
        clearSendAlert(compose);
        triggerGmailSend(compose);
      } else {
        // block override keeps the explicit two-step confirmation.
        text.textContent = 'Click Send again to send this email without a ProofLine signature.';
        unsigned.remove();
      }
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
 *  container for a fresh draft without it looking pre-signed. For an unsigned
 *  send (allow mode, warn confirm, or block override) PFL-190 appends the
 *  recipient footer (if the policy enables it) and notifies the caller so it
 *  can show the sender notice and audit the send. */
function onSendAllowed(compose: Element, deps: SendGuardDeps): void {
  const overrode = compose.getAttribute(SEND_UNSIGNED_ATTR) === 'true';
  const wasSigned = getSignState(compose) === 'signed';
  compose.removeAttribute(SEND_UNSIGNED_ATTR);
  if (wasSigned) {
    // A valid signed send: clear guard state so Gmail may recycle the
    // container. Signed emails never get the unsigned footer or notice.
    clearComposeGuardState(compose);
    return;
  }
  // Insert the footer BEFORE Gmail serializes the body. onSendAllowed runs in
  // the capture phase, ahead of Gmail's own Send handler, so the footer is in
  // place when Gmail reads the body. insertUnsignedFooter is idempotent, so a
  // resend never duplicates it.
  const footerAdded = shouldAppendFooter() ? insertUnsignedFooter(compose) : false;
  deps.onUnsignedSend?.(compose, { overrode, footerAdded });
}

/**
 * Installs the capture-phase listeners. Returns an uninstall function.
 */
export function installSendGuard(doc: Document, deps: SendGuardDeps): () => void {
  const onPointer = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // The Sign button's own handler drives the signing lifecycle (validate →
    // beginSigning → pending + progress + timeout). The guard only needs to
    // not mistake the Sign button for Gmail's Send button.
    if (target.closest(`[${INJECTED_MARKER}="true"]`)) return;

    if (!isGmailSendButton(target)) return;
    const compose = composeFor(target, deps);
    if (!compose) return;
    const reason = sendBlockReason(compose);
    if (!reason) {
      if (event.type === 'click') onSendAllowed(compose, deps);
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
      onSendAllowed(compose, deps);
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
