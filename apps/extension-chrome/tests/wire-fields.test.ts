/**
 * PFL-135 — "Wire instruction" toggle mounted in compose, wire fields in
 * the signed payload, invalid fields block signing.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { mountWireFields, getWireState } from '../src/content/wire-fields.js';
import { buildSignPayload } from '../src/content/sign-payload.js';
import { tryInject } from '../src/content/inject-toolbar.js';

function buildCompose(): { dialog: HTMLElement; toolbar: HTMLElement } {
  document.body.innerHTML = '';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'New Message');
  dialog.innerHTML = `
    <div role="listbox" aria-label="To"><span email="bob@scotia.test" data-hovercard-id="bob@scotia.test">bob@scotia.test</span></div>
    <input name="subjectbox" value="Wire instructions for closing" />
    <div role="textbox" aria-label="Message Body" contenteditable="true">Please wire the funds.</div>
    <div role="toolbar"></div>
  `;
  document.body.appendChild(dialog);
  return { dialog, toolbar: dialog.querySelector('[role="toolbar"]') as HTMLElement };
}

function fill(dialog: Element, values: { amount?: string; account?: string; routing?: string; memo?: string }) {
  const set = (sel: string, v?: string) => {
    if (v === undefined) return;
    const el = dialog.querySelector<HTMLInputElement>(sel)!;
    el.value = v;
    el.dispatchEvent(new Event('input'));
  };
  set('[data-wire-amount]', values.amount);
  set('[data-wire-account]', values.account);
  set('[data-wire-routing]', values.routing);
  set('[data-wire-memo]', values.memo);
}

function toggle(dialog: Element, on: boolean) {
  const box = dialog.querySelector<HTMLInputElement>('[data-proofline-wire-checkbox]')!;
  box.checked = on;
  box.dispatchEvent(new Event('change'));
}

let dialog: HTMLElement;
let toolbar: HTMLElement;

beforeEach(() => {
  ({ dialog, toolbar } = buildCompose());
});

describe('mountWireFields', () => {
  it('mounts once and reveals the fields only when toggled', () => {
    mountWireFields(dialog, toolbar);
    mountWireFields(dialog, toolbar);
    expect(dialog.querySelectorAll('[data-proofline-wire-checkbox]')).toHaveLength(1);

    const panel = dialog.querySelector<HTMLElement>('[data-proofline-wire-panel]')!;
    expect(panel.style.display).toBe('none');
    toggle(dialog, true);
    expect(panel.style.display).toBe('flex');
  });

  it('tryInject mounts the wire toggle next to the Sign button', () => {
    expect(tryInject(dialog)).toBe(true);
    expect(toolbar.querySelector('[data-proofline-wire-checkbox]')).not.toBeNull();
  });
});

describe('getWireState', () => {
  beforeEach(() => mountWireFields(dialog, toolbar));

  it('is not a wire when the toggle is off', () => {
    expect(getWireState(dialog)).toEqual({ isWireInstruction: false, isHighValue: false, isValid: true });
  });

  it('returns the wire payload and the high-value flag', () => {
    toggle(dialog, true);
    fill(dialog, { amount: '400000', account: 'XXXX4321', routing: '021000021', memo: 'Closing 123 Main St' });
    expect(getWireState(dialog)).toEqual({
      isWireInstruction: true,
      isHighValue: true,
      isValid: true,
      wirePayload: {
        v: 1, amount: 400000, currency: 'USD',
        recipientAccount: 'XXXX4321', recipientRouting: '021000021', memo: 'Closing 123 Main St',
      },
    });
  });

  it('marks fields that would fail the WirePayload schema as invalid', () => {
    toggle(dialog, true);
    fill(dialog, { amount: '0.2', account: 'acct', routing: '12345' });
    expect(getWireState(dialog).isValid).toBe(false);
    for (const sel of ['[data-wire-amount]', '[data-wire-account]', '[data-wire-routing]']) {
      expect(dialog.querySelector(sel)!.getAttribute('aria-invalid')).toBe('true');
    }
  });
});

describe('buildSignPayload', () => {
  beforeEach(() => mountWireFields(dialog, toolbar));

  it('signs a plain email when the toggle is off', () => {
    const r = buildSignPayload(dialog);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.isWireInstruction).toBe(false);
      expect(r.payload.wirePayload).toBeUndefined();
    }
  });

  it('includes the wire fields in the payload when toggled on', () => {
    toggle(dialog, true);
    fill(dialog, { amount: '12500', account: '000123456789', routing: '021000021' });
    const r = buildSignPayload(dialog);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.to).toEqual(['bob@scotia.test']);
      expect(r.payload.isWireInstruction).toBe(true);
      expect(r.payload.wirePayload).toMatchObject({ amount: 12500, recipientRouting: '021000021' });
      expect(r.isHighValue).toBe(false);
    }
  });

  it('blocks signing while wire fields are invalid', () => {
    toggle(dialog, true);
    fill(dialog, { amount: '12500', account: '000123456789', routing: 'abc' });
    expect(buildSignPayload(dialog)).toEqual({ ok: false, reason: 'wire_invalid' });
  });
});
