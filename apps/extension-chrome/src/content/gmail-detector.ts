import {
  COMPOSE_DIALOG_SELECTOR,
  TOOLBAR_SELECTORS,
  findToolbar,
} from './shared.js';

// Pure DOM-query layer. No side effects, no chrome.*, no global state —
// everything here is unit-testable under jsdom by passing a Document or
// DocumentFragment in.

export function findComposeDialogs(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(COMPOSE_DIALOG_SELECTOR));
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
