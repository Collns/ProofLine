/**
 * PFL-190 — the recipient "sent unsigned" footer.
 *
 * Rules under test: inserted into the body; placed BEFORE quoted reply text;
 * never duplicated; removable (so it can't leak into a later signature).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertUnsignedFooter,
  removeUnsignedFooter,
  hasUnsignedFooter,
  UNSIGNED_FOOTER_ATTR,
  UNSIGNED_FOOTER_TEXT,
} from '../src/content/unsigned-footer.js';

const FOOTER = `[${UNSIGNED_FOOTER_ATTR}]`;

function composeWith(bodyHtml: string): Element {
  document.body.innerHTML = '';
  const compose = document.createElement('div');
  const editable = document.createElement('div');
  editable.setAttribute('role', 'textbox');
  editable.setAttribute('contenteditable', 'true');
  editable.innerHTML = bodyHtml;
  compose.appendChild(editable);
  document.body.appendChild(compose);
  return compose;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('insertUnsignedFooter', () => {
  it('appends the footer to a plain compose body', () => {
    const compose = composeWith('Hello there.');
    expect(insertUnsignedFooter(compose)).toBe(true);
    const footer = compose.querySelector(FOOTER)!;
    expect(footer).not.toBeNull();
    expect(footer.textContent).toBe(UNSIGNED_FOOTER_TEXT);
    expect(hasUnsignedFooter(compose)).toBe(true);
  });

  it('inserts BEFORE quoted reply text, never inside it', () => {
    const compose = composeWith(
      'My reply.<div class="gmail_quote"><blockquote>Original message</blockquote></div>',
    );
    expect(insertUnsignedFooter(compose)).toBe(true);
    const quote = compose.querySelector('.gmail_quote')!;
    const footer = compose.querySelector(FOOTER)!;
    // The footer is a previous sibling of the quote (outside it).
    expect(quote.contains(footer)).toBe(false);
    expect(footer.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never duplicates — a second insert is a no-op', () => {
    const compose = composeWith('Body.');
    expect(insertUnsignedFooter(compose)).toBe(true);
    expect(insertUnsignedFooter(compose)).toBe(false);
    expect(compose.querySelectorAll(FOOTER)).toHaveLength(1);
  });

  it('returns false when there is no editable body', () => {
    document.body.innerHTML = '';
    const compose = document.createElement('div');
    document.body.appendChild(compose);
    expect(insertUnsignedFooter(compose)).toBe(false);
  });
});

describe('removeUnsignedFooter', () => {
  it('strips the footer so it cannot enter a later signature', () => {
    const compose = composeWith('Body.');
    insertUnsignedFooter(compose);
    removeUnsignedFooter(compose);
    expect(compose.querySelector(FOOTER)).toBeNull();
    expect(hasUnsignedFooter(compose)).toBe(false);
  });

  it('is a no-op when no footer is present', () => {
    const compose = composeWith('Body.');
    expect(() => removeUnsignedFooter(compose)).not.toThrow();
    expect(compose.querySelector(FOOTER)).toBeNull();
  });
});
