/**
 * PFL-181 — regression tests for three live-Gmail send-guard bugs:
 *
 *   1. The guard must block in EVERY compose surface, including inline
 *      reply / forward boxes that are not `role="dialog"` (bug 1).
 *   2. Guard state is per compose instance: signing one compose must not
 *      unlock another, a signature only unlocks the exact draft it was made
 *      for (editing after signing re-locks), and a recycled container is not
 *      treated as pre-signed (bug 2).
 *   3. An unsigned wire can NEVER be sent (no "Send unsigned"), and injected
 *      ProofLine UI must never live inside / modify Gmail's editable body
 *      (bug 3).
 *
 * These drive the REAL detector (findComposeContainers) and the REAL
 * injector (tryInject), not the hand-rolled fixtures of send-guard.test.ts,
 * so compose resolution, id stamping, and UI placement are all exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { findComposeContainers } from '../src/content/gmail-detector.js';
import { tryInject } from '../src/content/inject-toolbar.js';
import {
  installSendGuard,
  markSigned,
  setSignState,
  sendBlockReason,
  SEND_ALERT_ATTR,
} from '../src/content/send-guard.js';

let uninstall: () => void = () => {};

function body(compose: Element): HTMLElement {
  return compose.querySelector<HTMLElement>('[role="textbox"]')!;
}
function sendButton(compose: Element): HTMLElement {
  return compose.querySelector<HTMLElement>('[role="button"][data-tooltip^="Send"]')!;
}
function wireCheckbox(compose: Element): HTMLInputElement {
  return compose.querySelector<HTMLInputElement>('[data-proofline-wire-checkbox]')!;
}

/** A floating compose dialog (new message, pop-out reply, forward dialog). */
function dialogHtml(label: string, bodyText = 'Message body text.'): string {
  return `
    <div role="dialog" aria-label="${label}">
      <div role="listbox" aria-label="To"><span email="bob@scotia.test" data-hovercard-id="bob@scotia.test">bob</span></div>
      <input name="subjectbox" value="Closing wire" />
      <div role="toolbar">
        <div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬" class="aoO">Send</div>
      </div>
      <div role="textbox" aria-label="Message Body" contenteditable="true">${bodyText}</div>
    </div>`;
}

/** An inline reply/forward box that is NOT a role="dialog". */
function inlineHtml(bodyText = 'Inline reply body.'): string {
  return `
    <div id="thread">
      <div role="listbox" aria-label="To"><span email="bob@scotia.test" data-hovercard-id="bob@scotia.test">bob</span></div>
      <input name="subjectbox" value="Re: Closing wire" />
      <div role="textbox" aria-label="Message Body" contenteditable="true">${bodyText}</div>
      <table><tbody>
        <tr class="btC"><td><div role="button" data-tooltip="Send ‪(Ctrl-Enter)‬" class="aoO">Send</div></td></tr>
      </tbody></table>
    </div>`;
}

/** Injects into every open compose and wires a bubble-phase Gmail-send spy
 *  to each Send button; returns the composes and their spies in order. */
function instrumentAll(): { composes: Element[]; sends: ReturnType<typeof vi.fn>[] } {
  const composes = findComposeContainers(document);
  for (const c of composes) tryInject(c);
  const sends = composes.map((c) => {
    const spy = vi.fn();
    sendButton(c).addEventListener('click', spy); // bubble phase — Gmail's own handler stand-in
    return spy;
  });
  return { composes, sends };
}

beforeEach(() => {
  document.body.innerHTML = '';
  uninstall = installSendGuard(document, { findComposes: findComposeContainers });
});
afterEach(() => uninstall());

describe('bug 1 — guard blocks an unsigned wire in every compose surface', () => {
  const surfaces: Array<[string, string]> = [
    ['new compose (dialog)', dialogHtml('New Message')],
    ['pop-out reply (dialog)', dialogHtml('Reply')],
    ['forward (dialog)', dialogHtml('Forward message')],
  ];

  for (const [name, html] of surfaces) {
    it(`blocks the unsigned wire in ${name}`, () => {
      document.body.innerHTML = html;
      const { composes, sends } = instrumentAll();
      expect(composes).toHaveLength(1);
      wireCheckbox(composes[0]!).checked = true;

      sendButton(composes[0]!).click();
      expect(sends[0]).not.toHaveBeenCalled();
      expect(sendBlockReason(composes[0]!)).toMatch(/wire instruction/);
    });
  }

  it('blocks the unsigned wire in an inline reply (not a dialog)', () => {
    document.body.innerHTML = inlineHtml();
    const { composes, sends } = instrumentAll();
    expect(composes).toHaveLength(1);
    expect(composes[0]!.getAttribute('role')).not.toBe('dialog');
    wireCheckbox(composes[0]!).checked = true;

    sendButton(composes[0]!).click();
    expect(sends[0]).not.toHaveBeenCalled();

    // Ctrl/Cmd+Enter inside the inline body is blocked too.
    const ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    body(composes[0]!).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('bug 2 — per-compose state, signature bound to the exact draft', () => {
  it('signing compose A does not unlock an unsigned wire in compose B', () => {
    document.body.innerHTML = dialogHtml('New Message') + dialogHtml('Reply');
    const { composes, sends } = instrumentAll();
    expect(composes).toHaveLength(2);
    const [a, b] = composes as [Element, Element];

    wireCheckbox(b).checked = true;        // B is an unsigned wire
    setSignState(a, 'pending');
    markSigned(a);                         // A gets signed

    expect(sendBlockReason(a)).toBeNull();
    expect(sendBlockReason(b)).toMatch(/wire instruction/);

    sendButton(a).click();
    expect(sends[0]).toHaveBeenCalledOnce();  // A sends
    sendButton(b).click();
    expect(sends[1]).not.toHaveBeenCalled();  // B still blocked
  });

  it('editing the body after signing re-locks Send', () => {
    document.body.innerHTML = dialogHtml('New Message');
    const { composes, sends } = instrumentAll();
    const c = composes[0]!;
    markSigned(c);
    expect(sendBlockReason(c)).toBeNull();

    body(c).textContent = 'Now the body says something entirely different.';
    expect(sendBlockReason(c)).toMatch(/changed after it was signed/);
    sendButton(c).click();
    expect(sends[0]).not.toHaveBeenCalled();
  });

  it('a sent signed message clears state so a recycled container is not pre-signed', () => {
    document.body.innerHTML = dialogHtml('New Message');
    const { composes, sends } = instrumentAll();
    const c = composes[0]!;
    markSigned(c);

    sendButton(c).click();                 // passes — signed + unchanged
    expect(sends[0]).toHaveBeenCalledOnce();

    // Gmail reuses the same element for a brand-new wire draft.
    wireCheckbox(c).checked = true;
    sendButton(c).click();
    expect(sends[0]).toHaveBeenCalledOnce(); // still once: the new wire is blocked
    expect(sendBlockReason(c)).toMatch(/wire instruction/);
  });
});

describe('bug 3 — unsigned wire never escapable, body never touched', () => {
  it('offers no "Send unsigned" button for an unsigned wire', () => {
    document.body.innerHTML = dialogHtml('New Message');
    const { composes } = instrumentAll();
    const c = composes[0]!;
    wireCheckbox(c).checked = true;

    sendButton(c).click();
    expect(c.querySelector('[data-proofline-send-unsigned-btn]')).toBeNull();
    // ...and there is no state transition that would ever release it.
    expect(sendBlockReason(c)).toMatch(/wire instruction/);
  });

  it('a non-wire failed sign DOES offer the one-time escape (contrast)', () => {
    document.body.innerHTML = dialogHtml('New Message');
    const { composes } = instrumentAll();
    const c = composes[0]!;
    setSignState(c, 'failed');
    sendButton(c).click();
    expect(c.querySelector('[data-proofline-send-unsigned-btn]')).not.toBeNull();
  });

  it('leaves the editable body untouched when toggling wire and after a blocked send', () => {
    document.body.innerHTML = dialogHtml('New Message', 'Please wire the funds today.');
    const { composes } = instrumentAll();
    const c = composes[0]!;
    const original = body(c).textContent;

    // Toggle the wire checkbox on (reveals our fields — in the toolbar).
    const cb = wireCheckbox(c);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(body(c).textContent).toBe(original);
    expect(body(c).querySelector('[data-proofline-wire-panel]')).toBeNull();
    expect(body(c).querySelector('[data-proofline-injected]')).toBeNull();

    // A blocked send must put its alert OUTSIDE the body, not in it.
    sendButton(c).click();
    expect(body(c).textContent).toBe(original);
    expect(body(c).querySelector(`[${SEND_ALERT_ATTR}]`)).toBeNull();
    const alert = c.querySelector(`[${SEND_ALERT_ATTR}]`);
    expect(alert).not.toBeNull();
    expect(body(c).contains(alert)).toBe(false);
  });
});
