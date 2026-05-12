import { describe, it, expect, beforeEach } from 'vitest';
import {
  findComposeContainers,
  findComposeDialogs,
  findInlineComposes,
  findToolbarWithSelector,
} from '../src/content/gmail-detector.js';

function makeCompose(label: string, innerHtml: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', label);
  wrap.innerHTML = innerHtml;
  return wrap;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findComposeDialogs', () => {
  it('finds compose dialog when present', () => {
    const compose = makeCompose('New Message', '<tr class="btC"></tr>');
    document.body.appendChild(compose);

    expect(findComposeDialogs(document)).toEqual([compose]);
  });

  it('returns empty when no dialog elements exist at all', () => {
    document.body.innerHTML = '<div>just some content, no dialog role</div>';
    expect(findComposeDialogs(document)).toHaveLength(0);
  });

  it('finds multiple compose dialogs in the same DOM', () => {
    const a = makeCompose('New Message', '<tr class="btC"></tr>');
    const b = makeCompose('Reply Message', '<tr class="btC"></tr>');
    document.body.append(a, b);

    expect(findComposeDialogs(document)).toEqual([a, b]);
  });
});

// Toolbar selector chain (TOOLBAR_SELECTORS in shared.ts):
//   1. tr.btC                                    — Gmail's send-button row
//   2. td.gU.Up                                  — cell that contains the
//                                                  Send button
//   3. div[role="dialog"] div[role="toolbar"]    — fallback to any toolbar
//                                                  inside a dialog
describe('findToolbarWithSelector — fallback chain', () => {
  it('returns the tr.btC selector first when present', () => {
    const compose = makeCompose(
      'New Message',
      '<table><tr class="btC" id="primary"></tr></table>' +
        '<td class="gU Up" id="cell"></td>' +
        '<div role="toolbar" id="aria-toolbar"></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('tr.btC');
    expect((match?.toolbar as HTMLElement).id).toBe('primary');
  });

  it('falls through to td.gU.Up when tr.btC is absent', () => {
    const compose = makeCompose(
      'New Message',
      '<table><tr><td class="gU Up" id="cell"></td></tr></table>' +
        '<div role="toolbar" id="aria-toolbar"></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('td.gU.Up');
    expect((match?.toolbar as HTMLElement).id).toBe('cell');
  });

  it('falls through to div[role="toolbar"] when both stronger selectors miss', () => {
    const compose = makeCompose(
      'New Message',
      '<div role="toolbar" id="aria-toolbar"></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('div[role="dialog"] div[role="toolbar"]');
    expect((match?.toolbar as HTMLElement).id).toBe('aria-toolbar');
  });

  it('returns null when every selector misses', () => {
    const compose = makeCompose('New Message', '<div class="totally-other"></div>');
    document.body.appendChild(compose);

    expect(findToolbarWithSelector(compose)).toBeNull();
  });
});

// PFL-071 — inline reply/forward composes are NOT inside a role="dialog".
// They live inside the thread tree, but share the tr.btC toolbar with the
// new-compose dialog. findInlineComposes anchors on the toolbar and walks
// up to the nearest ancestor that holds both the toolbar and a body.
function makeInlineReply(opts: { containerClass?: string } = {}): HTMLElement {
  const thread = document.createElement('div');
  thread.id = 'thread-1';
  const reply = document.createElement('div');
  reply.className = opts.containerClass ?? 'ip iq';
  reply.innerHTML = [
    '<div role="textbox" aria-label="Message Body" contenteditable="true"></div>',
    '<table><tr class="btC"><td>Send</td></tr></table>',
  ].join('');
  thread.appendChild(reply);
  document.body.appendChild(thread);
  return reply;
}

describe('findInlineComposes', () => {
  it('returns inline reply containers that hold a tr.btC + contenteditable body', () => {
    const reply = makeInlineReply();
    expect(findInlineComposes(document)).toContain(reply);
  });

  it('ignores tr.btC toolbars that are already inside a role="dialog" (those go through findComposeDialogs)', () => {
    document.body.innerHTML = '';
    const dialog = makeCompose(
      'New Message',
      '<div role="textbox" aria-label="Message Body" contenteditable="true"></div>' +
        '<table><tr class="btC"></tr></table>',
    );
    document.body.appendChild(dialog);
    expect(findInlineComposes(document)).toHaveLength(0);
  });

  it('deduplicates when multiple toolbars resolve to the same ancestor', () => {
    document.body.innerHTML = '';
    const reply = document.createElement('div');
    reply.className = 'ip iq';
    reply.innerHTML = [
      '<div role="textbox" aria-label="Message Body" contenteditable="true"></div>',
      '<table><tr class="btC"></tr></table>',
      '<table><tr class="btC"></tr></table>',
    ].join('');
    document.body.appendChild(reply);
    expect(findInlineComposes(document)).toEqual([reply]);
  });

  it('returns empty when no inline composes exist', () => {
    document.body.innerHTML = '<div>just a thread, no reply open</div>';
    expect(findInlineComposes(document)).toEqual([]);
  });
});

describe('findComposeContainers', () => {
  it('returns the union of dialog composes and inline replies', () => {
    document.body.innerHTML = '';
    const dialog = makeCompose('New Message', '<tr class="btC"></tr>');
    document.body.appendChild(dialog);
    const reply = makeInlineReply();

    const found = findComposeContainers(document);
    expect(found).toContain(dialog);
    expect(found).toContain(reply);
    expect(found).toHaveLength(2);
  });

  it('returns just dialogs when no inline composes are present', () => {
    document.body.innerHTML = '';
    const dialog = makeCompose('New Message', '<tr class="btC"></tr>');
    document.body.appendChild(dialog);
    expect(findComposeContainers(document)).toEqual([dialog]);
  });

  it('returns just inline composes when no dialogs are present', () => {
    document.body.innerHTML = '';
    const reply = makeInlineReply();
    expect(findComposeContainers(document)).toEqual([reply]);
  });
});
