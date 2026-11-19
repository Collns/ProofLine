/**
 * PFL-096 — Gmail Send is blocked while signing is pending/failed, while a
 * cosigner is required, or for an unsigned wire; "Send unsigned" is an
 * explicit one-time escape hatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  installSendGuard,
  setSignState,
  getSignState,
  sendBlockReason,
  isGmailSendButton,
  SEND_ALERT_ATTR,
} from '../src/content/send-guard.js';

let uninstall: () => void = () => {};
let gmailSend: ReturnType<typeof vi.fn>;
const onSendUnsigned = vi.fn();

function buildCompose(): { compose: HTMLElement; send: HTMLElement; sign: HTMLElement; body: HTMLElement } {
  document.body.innerHTML = '';
  const compose = document.createElement('div');
  compose.setAttribute('role', 'dialog');
  compose.innerHTML = `
    <div role="textbox" contenteditable="true" aria-label="Message Body">Hello</div>
    <div class="toolbar-row">
      <div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬" class="aoO">Send</div>
      <button type="button" data-proofline-injected="true">Sign with ProofLine</button>
      <input type="checkbox" data-proofline-wire-checkbox="true" />
    </div>
  `;
  document.body.appendChild(compose);
  const send = compose.querySelector<HTMLElement>('[role="button"]')!;
  // Stand-in for Gmail's own (bubble-phase) Send handler.
  gmailSend = vi.fn();
  send.addEventListener('click', gmailSend);
  return {
    compose,
    send,
    sign: compose.querySelector<HTMLElement>('[data-proofline-injected]')!,
    body: compose.querySelector<HTMLElement>('[role="textbox"]')!,
  };
}

let compose: HTMLElement;
let send: HTMLElement;
let sign: HTMLElement;
let body: HTMLElement;

beforeEach(() => {
  ({ compose, send, sign, body } = buildCompose());
  onSendUnsigned.mockClear();
  uninstall = installSendGuard(document, {
    findComposes: (root) => Array.from(root.querySelectorAll('[role="dialog"]')),
    onSendUnsigned,
  });
});

afterEach(() => uninstall());

function ctrlEnter(target: Element): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

describe('detection + state', () => {
  it('recognises Gmail Send but not the ProofLine Sign button', () => {
    expect(isGmailSendButton(send)).toBe(true);
    expect(isGmailSendButton(sign)).toBe(false);
  });

  it('does not interfere when signing was never attempted', () => {
    expect(sendBlockReason(compose)).toBeNull();
    send.click();
    expect(gmailSend).toHaveBeenCalledOnce();
  });

  it('a Sign click marks the compose pending', () => {
    sign.click();
    expect(getSignState(compose)).toBe('pending');
  });
});

describe('blocking', () => {
  it('blocks Send while signing is pending and shows the alert', () => {
    setSignState(compose, 'pending');
    send.click();
    expect(gmailSend).not.toHaveBeenCalled();
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)?.textContent).toContain('still signing');
  });

  it('blocks Send after a failed sign, and Ctrl/Cmd+Enter too', () => {
    setSignState(compose, 'failed');
    send.click();
    expect(gmailSend).not.toHaveBeenCalled();
    const ev = ctrlEnter(body);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('blocks Send while a cosigner is required, with no "Send unsigned" escape (PFL-136)', () => {
    setSignState(compose, 'cosign_pending');
    send.click();
    expect(gmailSend).not.toHaveBeenCalled();
    expect(sendBlockReason(compose)).toMatch(/waiting for a cosigner/);
    expect(compose.querySelector('[data-proofline-send-unsigned-btn]')).toBeNull();
  });

  it('blocks an unsigned wire instruction even without a sign attempt', () => {
    compose.querySelector<HTMLInputElement>('[data-proofline-wire-checkbox]')!.checked = true;
    send.click();
    expect(gmailSend).not.toHaveBeenCalled();
    expect(sendBlockReason(compose)).toMatch(/wire instruction/);
  });

  it('lets a signed message through and clears the alert', () => {
    setSignState(compose, 'failed');
    send.click();
    setSignState(compose, 'signed');
    expect(compose.querySelector(`[${SEND_ALERT_ATTR}]`)).toBeNull();
    send.click();
    expect(gmailSend).toHaveBeenCalledOnce();
    expect(ctrlEnter(body).defaultPrevented).toBe(false);
  });
});

describe('escape hatches', () => {
  it('"Send unsigned" allows exactly the next send and is reported', () => {
    setSignState(compose, 'failed');
    send.click();
    compose.querySelector<HTMLElement>('[data-proofline-send-unsigned-btn]')!.click();
    expect(onSendUnsigned).toHaveBeenCalledWith(compose);

    send.click();
    expect(gmailSend).toHaveBeenCalledOnce();

    send.click();
    expect(gmailSend).toHaveBeenCalledOnce(); // blocked again: the choice was one-time
  });

  it('"Retry signing" re-runs the Sign button', () => {
    const signClick = vi.fn();
    sign.addEventListener('click', signClick);
    setSignState(compose, 'failed');
    send.click();
    compose.querySelector<HTMLElement>('[data-proofline-retry-sign]')!.click();
    expect(signClick).toHaveBeenCalledOnce();
    expect(getSignState(compose)).toBe('pending');
  });
});
