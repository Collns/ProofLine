// DOM helpers used by content-script modules. Plain DOM API only —
// no jQuery, no lodash, no DOM utility libraries.

export const INJECTED_MARKER = 'data-proofline-injected';
export const TOOLBAR_NOT_FOUND_MARKER = 'data-proofline-toolbar-not-found';

// PFL-181: a stable per-instance id stamped on each compose the first time
// we instrument it. Unlike Gmail's draft id (often absent until the server
// assigns one) this is always present once the Sign button is injected, so
// the send guard and the PAYLOAD_SIGNED router can both find the exact
// compose a Send click or a background reply belongs to — including inline
// reply / forward boxes where the draft id never materializes.
export const COMPOSE_ID_ATTR = 'data-proofline-compose-id';

let composeIdCounter = 0;

/** Stamps a stable id on the compose if it doesn't have one, and returns it. */
export function ensureComposeId(compose: Element): string {
  const existing = compose.getAttribute(COMPOSE_ID_ATTR);
  if (existing) return existing;
  const id =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? `pfl-${crypto.randomUUID()}`
      : `pfl-${Date.now()}-${composeIdCounter++}`;
  compose.setAttribute(COMPOSE_ID_ATTR, id);
  return id;
}

/**
 * True when `el` is inside (or is) a rich-text editable region — Gmail's
 * message body. Injected ProofLine UI must never live here: anything inside
 * the editable is serialized into the sent email (and in some layouts can
 * displace the user's own body). The only exception is the signed banner,
 * which is intentionally placed in the body after a successful sign.
 */
export function isInsideEditable(el: Element | null): boolean {
  return el?.closest('[contenteditable="true"], [role="textbox"], [g_editable="true"]') != null;
}

// Compose-dialog selector. Gmail labels the dialog with aria-label
// "New Message" / "Reply" / etc — the substring "essage" is stable
// across those (case-insensitive).
export const COMPOSE_DIALOG_SELECTOR =
  'div[role="dialog"]';

// PFL-071: inline reply/forward compose containers live INSIDE the
// message thread, not inside a `div[role="dialog"]`. They share the
// same `tr.btC` send-button toolbar — so we anchor on the toolbar and
// walk up to the smallest ancestor that holds both the toolbar AND a
// contenteditable body. That ancestor is the compose container.
export const INLINE_COMPOSE_BODY_SELECTOR =
  'div[role="textbox"][aria-label*="Message Body" i], div[g_editable="true"][role="textbox"], div[contenteditable="true"]';

// Toolbar selector fallback chain (first match wins). Gmail rewrites
// minified class names occasionally — semantic + aria-label fallbacks
// keep us alive a little longer when that happens.
export const TOOLBAR_SELECTORS: readonly string[] = [
  'tr.btC',
  'td.gU.Up',
  'div[role="dialog"] div[role="toolbar"]',
];

export function alreadyInjected(compose: Element): boolean {
  return compose.querySelector(`[${INJECTED_MARKER}="true"]`) !== null;
}

/**
 * Given any element inside a compose (e.g. the Gmail Send button), return the
 * compose container we instrumented — the nearest ancestor carrying
 * {@link COMPOSE_ID_ATTR}. Falls back to the nearest ancestor that holds a
 * ProofLine Sign button, so it still works before an id was stamped.
 *
 * This is the single source of truth the send guard uses, so a Send click in
 * an inline reply / forward resolves to the same element that holds the sign
 * state — independent of Gmail's dialog-vs-inline DOM differences.
 */
export function resolveInstrumentedCompose(target: Element | null): Element | null {
  if (!target) return null;
  const byId = target.closest(`[${COMPOSE_ID_ATTR}]`);
  if (byId) return byId;
  const btn = target.closest(`[${INJECTED_MARKER}="true"]`);
  if (!btn) return null;
  // Climb to the smallest ancestor that also contains the editable body:
  // that is the compose container (mirrors findInlineComposes).
  let cursor: Element | null = btn.parentElement;
  while (cursor) {
    if (cursor.querySelector('[contenteditable="true"], [role="textbox"]')) return cursor;
    cursor = cursor.parentElement;
  }
  return btn.parentElement;
}

export function findToolbar(compose: Element): Element | null {
  for (const sel of TOOLBAR_SELECTORS) {
    const found = compose.querySelector(sel);
    if (found) return found;
  }
  return null;
}

// Try to extract a stable-ish identifier for the compose. Gmail puts
// a draft id on the form; if we can't find one we fall back to null.
export function readComposeId(compose: Element): string | null {
  const form = compose.querySelector('form');
  if (form) {
    const draft = form.getAttribute('data-draft-id') ?? form.getAttribute('id');
    if (draft) return draft;
  }
  const idAttr = compose.getAttribute('data-message-id');
  return idAttr ?? null;
}
