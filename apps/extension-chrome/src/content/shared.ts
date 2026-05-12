// DOM helpers used by content-script modules. Plain DOM API only —
// no jQuery, no lodash, no DOM utility libraries.

export const INJECTED_MARKER = 'data-proofline-injected';
export const TOOLBAR_NOT_FOUND_MARKER = 'data-proofline-toolbar-not-found';

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
