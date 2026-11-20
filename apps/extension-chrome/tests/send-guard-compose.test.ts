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
  setUnsignedPolicy,
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

  it('in an inline reply, the send-blocked alert sits ABOVE the toolbar, keeping the wire panel below it (PFL-181 #4)', () => {
    document.body.innerHTML = inlineHtml();
    const { composes } = instrumentAll();
    const c = composes[0]!;
    wireCheckbox(c).checked = true;
    sendButton(c).click();

    const alert = c.querySelector(`[${SEND_ALERT_ATTR}]`)!;
    const toolbarTable = c.querySelector('table')!;
    const panel = c.querySelector('[data-proofline-wire-panel]')!;
    // The alert is a block child of the compose, not wedged inside the table.
    expect(alert.parentElement).toBe(c);
    expect(toolbarTable.contains(alert)).toBe(false);
    // Order within the compose: alert → toolbar → panel (panel stays below).
    const kids = Array.from(c.children);
    expect(kids.indexOf(alert)).toBeLessThan(kids.indexOf(toolbarTable));
    expect(kids.indexOf(toolbarTable)).toBeLessThan(kids.indexOf(panel));
  });

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

  it('clears the send-blocked alert when Wire instruction is unticked (PFL-181 #4)', () => {
    document.body.innerHTML = dialogHtml('New Message');
    const { composes, sends } = instrumentAll();
    const c = composes[0]!;
    const cb = wireCheckbox(c);

    cb.checked = true;
    sendButton(c).click();
    expect(sends[0]).not.toHaveBeenCalled();
    expect(c.querySelector(`[${SEND_ALERT_ATTR}]`)).not.toBeNull();

    // Untick → no longer a wire; the stale block alert must disappear.
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(c.querySelector(`[${SEND_ALERT_ATTR}]`)).toBeNull();
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

// ─── PFL-188: company unsigned-email policy ───────────────────────────────────

describe('unsigned-email policy (PFL-188)', () => {
  afterEach(() => setUnsignedPolicy({ mode: 'allow', allowOverride: true }));

  const surfaces: Array<[string, string]> = [
    ['new compose', dialogHtml('New Message')],
    ['pop-out reply', dialogHtml('Reply')],
    ['inline reply', inlineHtml()],
  ];

  for (const [name, html] of surfaces) {
    it(`block policy blocks a plain unsigned email in ${name}`, () => {
      setUnsignedPolicy({ mode: 'block', allowOverride: true });
      document.body.innerHTML = html;
      const { composes, sends } = instrumentAll();
      sendButton(composes[0]!).click();
      expect(sends[0]).not.toHaveBeenCalled();
      expect(sendBlockReason(composes[0]!)).toMatch(/requires outgoing email to be signed/);
    });

    it(`allow policy lets a plain unsigned email send in ${name}`, () => {
      setUnsignedPolicy({ mode: 'allow', allowOverride: true });
      document.body.innerHTML = html;
      const { composes, sends } = instrumentAll();
      sendButton(composes[0]!).click();
      expect(sends[0]).toHaveBeenCalledOnce();
    });

    it(`warn policy blocks until confirmed in ${name}`, () => {
      setUnsignedPolicy({ mode: 'warn', allowOverride: true });
      document.body.innerHTML = html;
      const { composes, sends } = instrumentAll();
      const c = composes[0]!;
      sendButton(c).click();
      expect(sends[0]).not.toHaveBeenCalled();
      // The one-click "Send without signing" confirm is offered.
      const confirm = c.querySelector<HTMLElement>('[data-proofline-send-unsigned-btn]');
      expect(confirm?.textContent).toBe('Send without signing');
      confirm!.click();
      sendButton(c).click();
      expect(sends[0]).toHaveBeenCalledOnce();
    });
  }

  it('block mode hides the override when the admin disallows it', () => {
    setUnsignedPolicy({ mode: 'block', allowOverride: false });
    document.body.innerHTML = dialogHtml('New Message');
    const { composes } = instrumentAll();
    sendButton(composes[0]!).click();
    expect(composes[0]!.querySelector('[data-proofline-send-unsigned-btn]')).toBeNull();
  });

  it('block mode offers the override when the admin allows it', () => {
    setUnsignedPolicy({ mode: 'block', allowOverride: true });
    document.body.innerHTML = dialogHtml('New Message');
    const { composes } = instrumentAll();
    sendButton(composes[0]!).click();
    const btn = composes[0]!.querySelector<HTMLElement>('[data-proofline-send-unsigned-btn]');
    expect(btn?.textContent).toBe('Send unsigned');
  });

  it('fail-closed (block, no override) blocks with no escape', () => {
    setUnsignedPolicy({ mode: 'block', allowOverride: false, failed: true });
    document.body.innerHTML = inlineHtml();
    const { composes, sends } = instrumentAll();
    sendButton(composes[0]!).click();
    expect(sends[0]).not.toHaveBeenCalled();
    expect(composes[0]!.querySelector('[data-proofline-send-unsigned-btn]')).toBeNull();
  });

  it('a wire is ALWAYS blocked unsigned with no override, even under allow policy', () => {
    setUnsignedPolicy({ mode: 'allow', allowOverride: true });
    document.body.innerHTML = dialogHtml('New Message');
    const { composes, sends } = instrumentAll();
    wireCheckbox(composes[0]!).checked = true;
    sendButton(composes[0]!).click();
    expect(sends[0]).not.toHaveBeenCalled();
    expect(sendBlockReason(composes[0]!)).toMatch(/wire instruction/);
    expect(composes[0]!.querySelector('[data-proofline-send-unsigned-btn]')).toBeNull();
  });
});
