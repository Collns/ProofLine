/**
 * @file wire-fields.ts
 * @module apps/extension-chrome/src/content
 *
 * "Mark as wire instruction" toggle + collapsible wire fields (PFL-049, F-EXT-06).
 *
 * Injects a compact row below the Sign button containing:
 *   [ ] Mark as wire instruction
 *
 * When checked, a panel expands revealing:
 *   Amount (USD)  [$__________]
 *   Account #     [__________]
 *   Routing #     [__________]  (must be exactly 9 digits)
 *   Memo          [__________]  (optional, max 500 chars)
 *
 * The caller (inject-toolbar) reads `getWireState(compose)` before building
 * the PAYLOAD_EXTRACTED message to obtain the current toggle state and field
 * values. If isWireInstruction=true the background will enforce F-SES-07
 * (high-value → always fresh biometric, regardless of session).
 *
 * Validation is inline (red border + aria-invalid) and mirrors the
 * WirePayload schema. When the toggle is on and a field is invalid, Sign
 * is blocked (sign-payload.ts) until the fields are fixed (PFL-135).
 *
 * Idempotency: a compose element is only instrumented once, tracked via
 * `data-proofline-wire-mounted`.
 */

import { warn } from '../shared/log.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WIRE_MOUNTED_ATTR = 'data-proofline-wire-mounted';
const WIRE_PANEL_ATTR   = 'data-proofline-wire-panel';
const WIRE_CHECK_ATTR   = 'data-proofline-wire-checkbox';

const HIGH_VALUE_THRESHOLD_USD = 50_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WireState {
  isWireInstruction: boolean;
  wirePayload?: {
    v: 1;
    amount: number;
    currency: 'USD';
    recipientAccount: string;
    recipientRouting: string;
    memo?: string;
  };
  /** true when amount >= HIGH_VALUE_THRESHOLD_USD */
  isHighValue: boolean;
  /** true when all required fields pass basic validation */
  isValid: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mounts the wire instruction toggle row into the compose toolbar.
 * Must be called after the Sign button has been injected.
 *
 * @param compose  Compose container element.
 * @param toolbar  Toolbar element — wire row is appended here.
 */
export function mountWireFields(compose: Element, toolbar: Element): void {
  if (compose.getAttribute(WIRE_MOUNTED_ATTR) === 'true') return;
  compose.setAttribute(WIRE_MOUNTED_ATTR, 'true');

  // PFL-181 #5: the compact toggle sits inline in the toolbar, but the fields
  // PANEL is a constrained block in the compose body column — NOT inline in
  // the toolbar row. Inline, its min-width widened the toolbar past the
  // compose, causing horizontal scroll, off-screen fields, and the panel
  // covering the send-blocked alert.
  const { checkRow, panel } = buildWireControls(compose);
  toolbar.appendChild(checkRow);
  compose.appendChild(panel);
}

/**
 * Returns the current wire state for a compose.
 * Returns `{ isWireInstruction: false, isHighValue: false, isValid: true }`
 * if wire fields haven't been mounted or the toggle is off.
 */
export function getWireState(compose: Element): WireState {
  const checkbox = compose.querySelector<HTMLInputElement>(
    `[${WIRE_CHECK_ATTR}]`,
  );
  if (!checkbox || !checkbox.checked) {
    return { isWireInstruction: false, isHighValue: false, isValid: true };
  }

  const panel = compose.querySelector<HTMLElement>(`[${WIRE_PANEL_ATTR}]`);
  if (!panel) {
    return { isWireInstruction: true, isHighValue: false, isValid: false };
  }

  const amountEl   = panel.querySelector<HTMLInputElement>('[data-wire-amount]');
  const accountEl  = panel.querySelector<HTMLInputElement>('[data-wire-account]');
  const routingEl  = panel.querySelector<HTMLInputElement>('[data-wire-routing]');
  const memoEl     = panel.querySelector<HTMLInputElement>('[data-wire-memo]');

  const amountRaw  = amountEl?.value.trim() ?? '';
  const account    = accountEl?.value.trim() ?? '';
  const routing    = routingEl?.value.trim() ?? '';
  const memo       = memoEl?.value.trim() ?? '';

  const amount     = parseFloat(amountRaw);
  const isValid    = validateFields(amount, account, routing, memo, panel);
  const isHighValue = !isNaN(amount) && amount >= HIGH_VALUE_THRESHOLD_USD;

  if (!isValid) {
    return { isWireInstruction: true, isHighValue, isValid: false };
  }

  return {
    isWireInstruction: true,
    isHighValue,
    isValid: true,
    wirePayload: {
      v: 1,
      amount: Math.round(amount),
      currency: 'USD',
      recipientAccount: account,
      recipientRouting: routing,
      ...(memo ? { memo } : {}),
    },
  };
}

// ─── DOM construction ─────────────────────────────────────────────────────────

const WIRE_ALERT_SELECTOR  = '[data-proofline-send-alert]';
const WIRE_NOTICE_SELECTOR = '[data-proofline-wire-notice]';

function buildWireControls(compose: Element): { checkRow: HTMLLabelElement; panel: HTMLDivElement } {
  // ── Compact toggle (inline in the toolbar) ──
  const checkRow = document.createElement('label');
  checkRow.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:5px',
    'margin-left:10px',
    'vertical-align:middle',
    'cursor:pointer',
    'color:#374151',
    'user-select:none',
    'white-space:nowrap',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:12px',
  ].join(';');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute(WIRE_CHECK_ATTR, 'true');
  checkbox.setAttribute('aria-label', 'Mark as wire instruction');
  checkbox.style.cssText = 'cursor:pointer;accent-color:#0D6EFD;width:13px;height:13px;';

  const checkLabel = document.createElement('span');
  checkLabel.textContent = 'Wire instruction';
  checkLabel.style.fontWeight = '500';

  checkRow.appendChild(checkbox);
  checkRow.appendChild(checkLabel);

  // ── Wire fields panel (constrained block, hidden until checked) ──
  const panel = buildFieldsPanel();
  panel.style.display = 'none';

  checkbox.addEventListener('change', () => {
    panel.style.display = checkbox.checked ? 'flex' : 'none';
    if (checkbox.checked) {
      const firstInput = panel.querySelector<HTMLInputElement>('input');
      firstInput?.focus();
    } else {
      // PFL-181 #4: unticking Wire instruction clears a stale send-blocked
      // alert and the invalid-fields notice — the message is no longer a wire.
      compose.querySelector(WIRE_ALERT_SELECTOR)?.remove();
      compose.querySelector(WIRE_NOTICE_SELECTOR)?.remove();
    }
  });

  return { checkRow, panel };
}

function buildFieldsPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.setAttribute(WIRE_PANEL_ATTR, 'true');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Wire instruction details');
  panel.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'margin:8px 0',
    'padding:10px 12px',
    'background:#f8fafc',
    'border:1px solid #e2e8f0',
    'border-radius:6px',
    // PFL-181 #5: flow within the compose column — never widen it. No fixed
    // min-width (it forced the toolbar/compose to overflow and scroll
    // sideways); box-sizing keeps padding inside the compose width.
    'width:100%',
    'max-width:100%',
    'box-sizing:border-box',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');

  // High-value warning banner (hidden by default)
  const highValueBanner = document.createElement('div');
  highValueBanner.setAttribute('data-wire-hv-banner', 'true');
  highValueBanner.style.cssText = [
    'display:none',
    'align-items:center',
    'gap:6px',
    'padding:5px 8px',
    'background:#fef2f2',
    'border:1px solid #fecaca',
    'border-radius:4px',
    'font-size:11px',
    'color:#dc2626',
    'font-weight:500',
  ].join(';');
  highValueBanner.textContent = '⚠ Amount exceeds $50,000 — fresh biometric required regardless of session.';

  panel.appendChild(highValueBanner);
  panel.appendChild(buildField('Amount (USD)', 'number', 'data-wire-amount', 'e.g. 25000', true));
  panel.appendChild(buildField('Account #', 'text', 'data-wire-account', 'Recipient account number', true));
  panel.appendChild(buildField('Routing #', 'text', 'data-wire-routing', '9-digit ABA routing number', true));
  panel.appendChild(buildField('Memo', 'text', 'data-wire-memo', 'Optional', false));

  // Wire up high-value banner to the amount field
  const amountInput = panel.querySelector<HTMLInputElement>('[data-wire-amount]');
  if (amountInput) {
    amountInput.addEventListener('input', () => {
      const val = parseFloat(amountInput.value);
      const isHV = !isNaN(val) && val >= HIGH_VALUE_THRESHOLD_USD;
      highValueBanner.style.display = isHV ? 'flex' : 'none';
    });
  }

  return panel;
}

function buildField(
  labelText: string,
  type: string,
  attr: string,
  placeholder: string,
  required: boolean,
): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

  const label = document.createElement('label');
  label.style.cssText = 'font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;';
  label.textContent = labelText + (required ? ' *' : '');

  const input = document.createElement('input');
  input.type = type;
  input.setAttribute(attr, 'true');
  input.setAttribute('placeholder', placeholder);
  if (required) input.setAttribute('aria-required', 'true');
  input.style.cssText = [
    'padding:4px 8px',
    'border:1px solid #d1d5db',
    'border-radius:4px',
    'font-size:12px',
    'font-family:inherit',
    'background:white',
    'outline:none',
    'width:100%',
    'box-sizing:border-box',
    'transition:border-color 0.15s',
  ].join(';');

  input.addEventListener('focus', () => { input.style.borderColor = '#0D6EFD'; });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#d1d5db';
    // Clear validation highlight on blur so user can see fresh state
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '#d1d5db';
  });

  label.appendChild(document.createTextNode(''));
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateFields(
  amount: number,
  account: string,
  routing: string,
  _memo: string,
  panel: HTMLElement,
): boolean {
  let valid = true;

  const amountEl  = panel.querySelector<HTMLInputElement>('[data-wire-amount]');
  const accountEl = panel.querySelector<HTMLInputElement>('[data-wire-account]');
  const routingEl = panel.querySelector<HTMLInputElement>('[data-wire-routing]');

  if (!amountEl || !accountEl || !routingEl) return false;

  if (isNaN(amount) || Math.round(amount) < 1) {
    markInvalid(amountEl, 'Amount must be a positive number of dollars.');
    valid = false;
  } else {
    markValid(amountEl);
  }

  // Matches the WirePayload schema: digits, optionally masked with X or •.
  if (!/^[0-9X•]{4,}$/.test(account)) {
    markInvalid(accountEl, 'Account number must be at least 4 digits (mask with X if needed).');
    valid = false;
  } else {
    markValid(accountEl);
  }

  if (!/^\d{9}$/.test(routing)) {
    markInvalid(routingEl, 'Routing number must be exactly 9 digits.');
    valid = false;
  } else {
    markValid(routingEl);
  }

  return valid;
}

function markInvalid(input: HTMLInputElement, message: string): void {
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('title', message);
  input.style.borderColor = '#dc2626';
}

function markValid(input: HTMLInputElement): void {
  input.removeAttribute('aria-invalid');
  input.removeAttribute('title');
  input.style.borderColor = '#16a34a';
}

/** Exported for tests — exposes the threshold constant. */
export const WIRE_HIGH_VALUE_THRESHOLD_USD = HIGH_VALUE_THRESHOLD_USD;