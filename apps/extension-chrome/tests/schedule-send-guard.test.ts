/**
 * PFL-190 enforcement-gap fix: every Gmail send surface funnels through one
 * guard. These tests drive the REAL detector + guard and cover the
 * previously-unguarded "Schedule send" path (menu item rendered OUTSIDE the
 * compose), plus Tab-to-Send keyboard activation and the stale-banner reconcile.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { findComposeContainers } from '../src/content/gmail-detector.js';
import { tryInject } from '../src/content/inject-toolbar.js';
import {
  installSendGuard,
  markSigned,
  setUnsignedPolicy,
  reconcileComposeGuard,
  SEND_ALERT_ATTR,
} from '../src/content/send-guard.js';
import { UNSIGNED_FOOTER_ATTR } from '../src/content/unsigned-footer.js';

const FOOTER = `[${UNSIGNED_FOOTER_ATTR}]`;

let uninstall: () => void = () => {};
const onUnsignedSend = vi.fn();

function composeHtml(bodyHtml = 'Body.'): string {
  return `
    <div role="dialog" aria-label="New Message">
      <div role="listbox" aria-label="To"><span email="bob@scotia.test">bob</span></div>
      <input name="subjectbox" value="Status" />
      <div role="toolbar">
        <div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬">Send</div>
        <div role="button" aria-label="More send options">▾</div>
      </div>
      <div role="textbox" aria-label="Message Body" contenteditable="true">${bodyHtml}</div>
    </div>`;
}

/** Gmail's "Schedule send" popup menu — rendered OUTSIDE the compose. */
function openScheduleMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<div role="menuitem" tabindex="0">Schedule send</div>';
  document.body.appendChild(menu); // sibling of the compose, not inside it
  return menu.querySelector<HTMLElement>('[role="menuitem"]')!;
}

function mountCompose(bodyHtml?: string): Element {
  document.body.insertAdjacentHTML('beforeend', composeHtml(bodyHtml));
  const compose = findComposeContainers(document)[0]!;
  tryInject(compose);
  return compose;
}

function scheduleItemSpy(item: HTMLElement): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  item.addEventListener('click', spy); // bubble-phase stand-in for Gmail's handler
  return spy;
}

beforeEach(() => {
  document.body.innerHTML = '';
  onUnsignedSend.mockClear();
  setUnsignedPolicy({ mode: 'allow', allowOverride: true });
  uninstall = installSendGuard(document, { findComposes: findComposeContainers, onUnsignedSend });
});
afterEach(() => {
  uninstall();
  setUnsignedPolicy({ mode: 'allow', allowOverride: true });
});

describe('Schedule send goes through the guard (PFL-190 bypass fix)', () => {
  it('BLOCKS an unsigned Schedule send under block policy — Gmail never schedules', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    const item = openScheduleMenu();
    const gmail = scheduleItemSpy(item);

    item.click();

    expect(gmail).not.toHaveBeenCalled();          // scheduling prevented
    expect(onUnsignedSend).not.toHaveBeenCalled();
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).not.toBeNull(); // alert on the compose
    expect(compose.querySelector(FOOTER)).toBeNull();
  });

  it('allows an unsigned Schedule send under allow policy, with footer + schedule path', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'allow', allowOverride: true });
    const item = openScheduleMenu();

    item.click();

    expect(onUnsignedSend).toHaveBeenCalledTimes(1);
    expect(onUnsignedSend.mock.calls[0]![1]).toMatchObject({ path: 'schedule', footerAdded: true });
    expect(compose.querySelectorAll(FOOTER)).toHaveLength(1);
  });

  it('block + override is a two-step schedule confirm', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: true });

    openScheduleMenu().click();                      // blocked, alert shown
    const override = compose.querySelector<HTMLElement>('[data-proofline-send-unsigned-btn]')!;
    expect(override).not.toBeNull();
    override.click();                                // arms the override (two-step)
    expect(onUnsignedSend).not.toHaveBeenCalled();   // not sent yet

    openScheduleMenu().click();                      // second Schedule send → allowed
    expect(onUnsignedSend).toHaveBeenCalledTimes(1);
    expect(onUnsignedSend.mock.calls[0]![1]).toMatchObject({ path: 'schedule' });
  });

  it('a signed compose may Schedule send with no footer or notice', () => {
    const compose = mountCompose();
    markSigned(compose);
    const gmail = scheduleItemSpy(openScheduleMenu());

    // re-open (the spy is on the first menu's item); click a fresh item
    const item = openScheduleMenu();
    const gmail2 = scheduleItemSpy(item);
    item.click();

    expect(gmail2).toHaveBeenCalled();               // scheduling proceeds
    expect(onUnsignedSend).not.toHaveBeenCalled();
    expect(compose.querySelector(FOOTER)).toBeNull();
    void gmail;
  });

  it('resolves the compose for the menu even though it lives outside the compose DOM', () => {
    // Single open compose → resolver falls back to it without any interaction.
    mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    const gmail = scheduleItemSpy(openScheduleMenu());
    document.querySelector<HTMLElement>('[role="menuitem"]')!.click();
    expect(gmail).not.toHaveBeenCalled();
  });
});

describe('Tab-to-Send keyboard activation goes through the guard', () => {
  it('blocks Enter on the focused Send button under block policy', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    const sendBtn = compose.querySelector<HTMLElement>('[role="button"][data-tooltip^="Send"]')!;
    const gmail = vi.fn();
    sendBtn.addEventListener('keydown', gmail); // Gmail's own key handler stand-in

    sendBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(gmail).not.toHaveBeenCalled();
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).not.toBeNull();
  });
});

describe('stale block banner clears on compose type/recipient change (PFL-190 #3)', () => {
  it('clears the banner + guard state when the recipients change', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    compose.querySelector<HTMLElement>('[role="button"][data-tooltip^="Send"]')!.click();
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).not.toBeNull();

    // Switch recipients (simulating Reply → Forward via the ▾ type menu).
    compose.querySelector('[role="listbox"]')!.innerHTML =
      '<span email="carol@acme.test">carol</span>';
    reconcileComposeGuard(compose);

    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).toBeNull();
  });

  it('leaves the banner when nothing changed', () => {
    const compose = mountCompose();
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    compose.querySelector<HTMLElement>('[role="button"][data-tooltip^="Send"]')!.click();
    reconcileComposeGuard(compose);
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).not.toBeNull();
  });
});
