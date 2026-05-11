import { describe, it, expect, beforeEach } from 'vitest';
import {
  findComposeDialogs,
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
