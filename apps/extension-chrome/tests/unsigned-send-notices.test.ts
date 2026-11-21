/**
 * PFL-190 — an unsigned send fires the onUnsignedSend hook (which the content
 * script turns into the sender notice + audit) and, when the policy enables it,
 * appends the recipient footer to the body.
 *
 * Covered: each unsigned path (allow / warn-confirm / block-override) across
 * dialog + inline compose surfaces; footer on vs off; a signed send gets
 * neither; the footer is never duplicated on a resend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { findComposeContainers } from '../src/content/gmail-detector.js';
import { tryInject } from '../src/content/inject-toolbar.js';
import {
  installSendGuard,
  markSigned,
  setUnsignedPolicy,
  type EffectiveUnsignedPolicy,
} from '../src/content/send-guard.js';
import { UNSIGNED_FOOTER_ATTR } from '../src/content/unsigned-footer.js';

const FOOTER = `[${UNSIGNED_FOOTER_ATTR}]`;

let uninstall: () => void = () => {};
const onUnsignedSend = vi.fn();
const onSendUnsigned = vi.fn();

function sendButton(compose: Element): HTMLElement {
  return compose.querySelector<HTMLElement>('[role="button"][data-tooltip^="Send"]')!;
}
function overrideButton(compose: Element): HTMLElement | null {
  return compose.querySelector<HTMLElement>('[data-proofline-send-unsigned-btn]');
}

function dialogHtml(label: string, bodyHtml = 'Message body text.'): string {
  return `
    <div role="dialog" aria-label="${label}">
      <div role="listbox" aria-label="To"><span email="bob@scotia.test" data-hovercard-id="bob@scotia.test">bob</span></div>
      <input name="subjectbox" value="Status update" />
      <div role="toolbar">
        <div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬" class="aoO">Send</div>
      </div>
      <div role="textbox" aria-label="Message Body" contenteditable="true">${bodyHtml}</div>
    </div>`;
}
function inlineHtml(bodyHtml = 'Inline reply body.'): string {
  return `
    <div id="thread">
      <div role="listbox" aria-label="To"><span email="bob@scotia.test" data-hovercard-id="bob@scotia.test">bob</span></div>
      <input name="subjectbox" value="Re: Status update" />
      <div role="textbox" aria-label="Message Body" contenteditable="true">${bodyHtml}</div>
      <table><tbody>
        <tr class="btC"><td><div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬" class="aoO">Send</div></td></tr>
      </tbody></table>
    </div>`;
}

function mount(html: string): Element {
  document.body.innerHTML = html;
  const compose = findComposeContainers(document)[0]!;
  tryInject(compose);
  return compose;
}

beforeEach(() => {
  document.body.innerHTML = '';
  onUnsignedSend.mockClear();
  onSendUnsigned.mockClear();
  setUnsignedPolicy({ mode: 'allow', allowOverride: true });
  uninstall = installSendGuard(document, {
    findComposes: findComposeContainers,
    onSendUnsigned,
    onUnsignedSend,
  });
});
afterEach(() => {
  uninstall();
  setUnsignedPolicy({ mode: 'allow', allowOverride: true });
});

/** Drive a given policy's unsigned-send path to an actual send. */
function sendUnsigned(compose: Element, policy: EffectiveUnsignedPolicy): void {
  setUnsignedPolicy(policy);
  sendButton(compose).click();
  if (policy.mode !== 'allow') {
    // block/warn: first click is blocked with an alert — choose the override.
    overrideButton(compose)?.click();
    sendButton(compose).click();
  }
}

describe('onUnsignedSend fires for every unsigned path × compose surface', () => {
  const surfaces: Array<[string, () => Element]> = [
    ['new compose (dialog)', () => mount(dialogHtml('New Message'))],
    ['pop-out reply (dialog)', () => mount(dialogHtml('Reply'))],
    ['forward (dialog)', () => mount(dialogHtml('Forward message'))],
    ['inline reply', () => mount(inlineHtml())],
  ];
  const paths: Array<[string, EffectiveUnsignedPolicy, boolean]> = [
    ['allow', { mode: 'allow', allowOverride: true }, false],
    ['warn confirm', { mode: 'warn', allowOverride: true }, true],
    ['block override', { mode: 'block', allowOverride: true }, true],
  ];

  for (const [sName, make] of surfaces) {
    for (const [pName, policy, overrode] of paths) {
      it(`${pName} in ${sName}`, () => {
        const compose = make();
        sendUnsigned(compose, policy);
        expect(onUnsignedSend).toHaveBeenCalledTimes(1);
        expect(onUnsignedSend.mock.calls[0]![1]).toMatchObject({ overrode, footerAdded: true });
        expect(compose.querySelectorAll(FOOTER)).toHaveLength(1);
      });
    }
  }
});

describe('recipient footer policy + placement', () => {
  it('does not add the footer when the company turned it off', () => {
    const compose = mount(dialogHtml('New Message'));
    sendUnsigned(compose, { mode: 'allow', allowOverride: true, appendFooter: false });
    expect(onUnsignedSend).toHaveBeenCalledTimes(1);
    expect(onUnsignedSend.mock.calls[0]![1]).toMatchObject({ footerAdded: false });
    expect(compose.querySelector(FOOTER)).toBeNull();
  });

  it('places the footer before quoted reply text', () => {
    const compose = mount(inlineHtml('My reply.<div class="gmail_quote"><blockquote>Prior</blockquote></div>'));
    sendUnsigned(compose, { mode: 'allow', allowOverride: true });
    const quote = compose.querySelector('.gmail_quote')!;
    const footer = compose.querySelector(FOOTER)!;
    expect(quote.contains(footer)).toBe(false);
  });

  it('never duplicates the footer on a resend', () => {
    const compose = mount(dialogHtml('New Message'));
    setUnsignedPolicy({ mode: 'allow', allowOverride: true });
    sendButton(compose).click();
    sendButton(compose).click();
    expect(compose.querySelectorAll(FOOTER)).toHaveLength(1);
    expect(onUnsignedSend).toHaveBeenCalledTimes(2);
    expect(onUnsignedSend.mock.calls[1]![1]).toMatchObject({ footerAdded: false });
  });
});

describe('a signed send gets neither footer nor notice', () => {
  it('does not fire onUnsignedSend and adds no footer', () => {
    const compose = mount(dialogHtml('New Message'));
    markSigned(compose);
    sendButton(compose).click();
    expect(onUnsignedSend).not.toHaveBeenCalled();
    expect(compose.querySelector(FOOTER)).toBeNull();
  });
});

describe('Ctrl/Cmd+Enter unsigned send', () => {
  it('fires onUnsignedSend and adds the footer', () => {
    const compose = mount(dialogHtml('New Message'));
    setUnsignedPolicy({ mode: 'allow', allowOverride: true });
    const body = compose.querySelector<HTMLElement>('[role="textbox"]')!;
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(onUnsignedSend).toHaveBeenCalledTimes(1);
    expect(compose.querySelectorAll(FOOTER)).toHaveLength(1);
  });
});
