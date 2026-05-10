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
    const compose = makeCompose('New Message', '<div class="btC"></div>');
    document.body.appendChild(compose);

    expect(findComposeDialogs(document)).toEqual([compose]);
  });

  it('returns empty when no compose dialogs exist', () => {
    document.body.innerHTML = '<div role="dialog" aria-label="Settings"></div>';
    expect(findComposeDialogs(document)).toHaveLength(0);
  });

  it('finds multiple compose dialogs in the same DOM', () => {
    const a = makeCompose('New Message', '<div class="btC"></div>');
    const b = makeCompose('Reply Message', '<div class="btC"></div>');
    document.body.append(a, b);

    expect(findComposeDialogs(document)).toEqual([a, b]);
  });
});

describe('findToolbarWithSelector — fallback chain', () => {
  it('returns the btC selector first when present', () => {
    const compose = makeCompose(
      'New Message',
      '<div class="btC" id="primary"></div><div gh="cm"><div role="toolbar" id="semantic"></div></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('div.btC');
    expect((match?.toolbar as HTMLElement).id).toBe('primary');
  });

  it('falls through to gh="cm" + role="toolbar" when btC is absent', () => {
    const compose = makeCompose(
      'New Message',
      '<div gh="cm"><div role="toolbar" id="semantic"></div></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('div[gh="cm"] div[role="toolbar"]');
    expect((match?.toolbar as HTMLElement).id).toBe('semantic');
  });

  it('falls through to aria-label*="ormatting" when both stronger selectors miss', () => {
    const compose = makeCompose(
      'New Message',
      '<div aria-label="Formatting options" id="aria"></div>',
    );
    document.body.appendChild(compose);

    const match = findToolbarWithSelector(compose);
    expect(match?.selector).toBe('div[aria-label*="ormatting" i]');
    expect((match?.toolbar as HTMLElement).id).toBe('aria');
  });

  it('returns null when every selector misses', () => {
    const compose = makeCompose('New Message', '<div class="totally-other"></div>');
    document.body.appendChild(compose);

    expect(findToolbarWithSelector(compose)).toBeNull();
  });
});
