import {
  COMPOSE_DIALOG_SELECTOR,
  INLINE_COMPOSE_BODY_SELECTOR,
  TOOLBAR_SELECTORS,
  findToolbar,
} from './shared.js';

// Pure DOM-query layer. No side effects, no chrome.*, no global state —
// everything here is unit-testable under jsdom by passing a Document or
// DocumentFragment in.

export function findComposeDialogs(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(COMPOSE_DIALOG_SELECTOR));
}

/**
 * PFL-071: locate reply/forward compose boxes that live INLINE inside
 * the message thread rather than in a floating dialog.
 *
 * Algorithm — anchor on `tr.btC` (the send-button toolbar, shared with
 * the dialog flow), filter out ones already inside a `role="dialog"`,
 * then walk up to the smallest ancestor that contains a contenteditable
 * body. That ancestor IS the compose container the rest of the
 * extension expects (toolbar + recipient chips + body all inside).
 *
 * Returns unique containers (a thread with multiple drafts open in
 * parallel produces multiple toolbars but each one resolves to a
 * different container).
 */
export function findInlineComposes(root: ParentNode): Element[] {
  const toolbars = Array.from(root.querySelectorAll('tr.btC'));
  const seen     = new Set<Element>();
  const out: Element[] = [];

  for (const toolbar of toolbars) {
    // Skip toolbars already inside a dialog — findComposeDialogs
    // returns that container already, no need to double-count.
    if (toolbar.closest(COMPOSE_DIALOG_SELECTOR)) continue;

    let cursor: Element | null = toolbar.parentElement;
    while (cursor && cursor !== root) {
      if (cursor.querySelector(INLINE_COMPOSE_BODY_SELECTOR)) {
        if (!seen.has(cursor)) {
          seen.add(cursor);
          out.push(cursor);
        }
        break;
      }
      cursor = cursor.parentElement;
    }
  }
  return out;
}

/**
 * PFL-070 + PFL-071: union of dialog composes and inline reply/forward
 * composes. Used by content/index.ts for both toolbar injection sweeps
 * AND post-sign banner injection lookup. Either path needs to handle
 * both compose styles or replies silently break.
 */
export function findComposeContainers(root: ParentNode): Element[] {
  return [...findComposeDialogs(root), ...findInlineComposes(root)];
}

export interface ToolbarMatch {
  toolbar: Element;
  selector: string;
}

// Runs the fallback chain explicitly so tests can assert which selector
// won. Returns `null` when every selector misses — caller is expected
// to surface a user-visible "extension needs an update" notice.
export function findToolbarWithSelector(compose: Element): ToolbarMatch | null {
  for (const selector of TOOLBAR_SELECTORS) {
    const toolbar = compose.querySelector(selector);
    if (toolbar) return { toolbar, selector };
  }
  return null;
}

// Convenience wrapper used by inject-toolbar in production paths.
export function locateToolbar(compose: Element): Element | null {
  return findToolbar(compose);
}
