// DOM helpers used by content-script modules. Plain DOM API only —
// no jQuery, no lodash, no DOM utility libraries.

export const INJECTED_MARKER = 'data-proofline-injected';
export const TOOLBAR_NOT_FOUND_MARKER = 'data-proofline-toolbar-not-found';

// Compose-dialog selector. Gmail labels the dialog with aria-label
// "New Message" / "Reply" / etc — the substring "essage" is stable
// across those (case-insensitive).
export const COMPOSE_DIALOG_SELECTOR =
  'div[role="dialog"][aria-label*="essage" i]';

// Toolbar selector fallback chain (first match wins). Gmail rewrites
// minified class names occasionally — semantic + aria-label fallbacks
// keep us alive a little longer when that happens.
export const TOOLBAR_SELECTORS: readonly string[] = [
  'div.btC',
  'div[gh="cm"] div[role="toolbar"]',
  'div[aria-label*="ormatting" i]',
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
