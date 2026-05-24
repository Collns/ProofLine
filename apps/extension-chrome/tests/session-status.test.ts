/**
 * @file session-status.test.ts + wire-fields.test.ts
 * @module apps/extension-chrome/tests
 *
 * Unit tests for PFL-049:
 *   - session-status: pill rendering for each state
 *   - session-status: storage change listener triggers re-render
 *   - wire-fields: toggle shows/hides panel
 *   - wire-fields: getWireState returns correct values
 *   - wire-fields: high-value threshold detection
 *   - wire-fields: validation flags
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mountSessionStatus,
  refreshSessionStatus,
  formatMinutesLeft,
} from '../src/content/session-status.js';
import {
  mountWireFields,
  getWireState,
  WIRE_HIGH_VALUE_THRESHOLD_USD,
} from '../src/content/wire-fields.js';

// ─── Chrome mock ──────────────────────────────────────────────────────────────

const storageListeners: Array<(changes: Record<string, unknown>) => void> = [];
const mockSendMessage = vi.fn();

(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    onChanged: {
      addListener: vi.fn((fn: (changes: Record<string, unknown>) => void) => {
        storageListeners.push(fn);
      }),
      removeListener: vi.fn((fn: (changes: Record<string, unknown>) => void) => {
        const idx = storageListeners.indexOf(fn);
        if (idx >= 0) storageListeners.splice(idx, 1);
      }),
    },
  },
};

function fireStorageChange(changes: Record<string, unknown>): void {
  storageListeners.forEach((fn) => fn(changes));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCompose(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  return el;
}

function makeToolbar(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'btC';
  return el;
}

// ─── formatMinutesLeft ────────────────────────────────────────────────────────

describe('formatMinutesLeft', () => {
  it('returns correct ceiling minutes', () => {
    const now = Date.now();
    expect(formatMinutesLeft(now + 12 * 60_000, now)).toBe(12);
    expect(formatMinutesLeft(now + 12 * 60_000 + 30_000, now)).toBe(13); // rounds up
    expect(formatMinutesLeft(now - 1000, now)).toBe(0); // never negative
  });

  it('returns 0 for expired sessions', () => {
    const now = Date.now();
    expect(formatMinutesLeft(now - 60_000, now)).toBe(0);
  });
});

// ─── mountSessionStatus ───────────────────────────────────────────────────────

describe('mountSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    storageListeners.length = 0;
  });

  it('injects a status pill into the toolbar', () => {
    const compose  = makeCompose();
    const toolbar  = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ authenticated: false });
    });

    mountSessionStatus(compose, toolbar, []);

    const pill = toolbar.querySelector('[data-proofline-status-pill]');
    expect(pill).not.toBeNull();
  });

  it('is idempotent — second call does not add a second pill', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ authenticated: false });
    });

    mountSessionStatus(compose, toolbar, []);
    mountSessionStatus(compose, toolbar, []);

    const pills = toolbar.querySelectorAll('[data-proofline-status-pill]');
    expect(pills.length).toBe(1);
  });

  it('renders "Not signed in" when not authenticated', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ authenticated: false });
    });

    mountSessionStatus(compose, toolbar, []);
    await vi.waitFor(() => {
      const pill = toolbar.querySelector('[data-proofline-status-pill]');
      expect(pill?.textContent).toContain('Not signed in');
    });
  });

  it('renders "No active session" when authenticated but no session', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mockSendMessage.mockImplementation(
      (msg: { type: string }, cb: (r: unknown) => void) => {
        if (msg.type === 'GET_AUTH_STATUS') cb({ authenticated: true });
        if (msg.type === 'GET_SESSION_STATUS') cb({ status: 'absent' });
      },
    );

    mountSessionStatus(compose, toolbar, ['mark@acme.com']);
    await vi.waitFor(() => {
      const pill = toolbar.querySelector('[data-proofline-status-pill]');
      expect(pill?.textContent).toContain('No active session');
    });
  });

  it('renders "Session active" with minutes when session is present', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    const expiresAt = Date.now() + 12 * 60_000;

    mockSendMessage.mockImplementation(
      (msg: { type: string }, cb: (r: unknown) => void) => {
        if (msg.type === 'GET_AUTH_STATUS') cb({ authenticated: true });
        if (msg.type === 'GET_SESSION_STATUS')
          cb({ status: 'active', expiresAt, email: 'mark@acme.com' });
      },
    );

    mountSessionStatus(compose, toolbar, ['recipient@bank.com']);
    await vi.waitFor(() => {
      const pill = toolbar.querySelector('[data-proofline-status-pill]');
      expect(pill?.textContent).toContain('Session active');
      expect(pill?.textContent).toContain('m left');
    });
  });

  it('renders warning when < 2 minutes remain', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    const expiresAt = Date.now() + 90_000; // 1.5 min

    mockSendMessage.mockImplementation(
      (msg: { type: string }, cb: (r: unknown) => void) => {
        if (msg.type === 'GET_AUTH_STATUS') cb({ authenticated: true });
        if (msg.type === 'GET_SESSION_STATUS')
          cb({ status: 'active', expiresAt, email: 'mark@acme.com' });
      },
    );

    mountSessionStatus(compose, toolbar, ['recipient@bank.com']);
    await vi.waitFor(() => {
      const pill = toolbar.querySelector('[data-proofline-status-pill]');
      expect(pill?.textContent).toContain('expiring');
    });
  });

  it('re-renders when a proofline:session storage key changes', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    let callCount = 0;
    mockSendMessage.mockImplementation(
      (msg: { type: string }, cb: (r: unknown) => void) => {
        callCount++;
        if (msg.type === 'GET_AUTH_STATUS') cb({ authenticated: true });
        if (msg.type === 'GET_SESSION_STATUS') cb({ status: 'absent' });
      },
    );

    mountSessionStatus(compose, toolbar, ['r@b.com']);
    await vi.waitFor(() => expect(callCount).toBeGreaterThan(0));

    const before = callCount;
    fireStorageChange({ 'proofline:session:somehash': { newValue: {} } });

    await vi.waitFor(() => expect(callCount).toBeGreaterThan(before));
  });
});

// ─── refreshSessionStatus ─────────────────────────────────────────────────────

describe('refreshSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('triggers a re-render when pill exists', async () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mockSendMessage.mockImplementation(
      (msg: { type: string }, cb: (r: unknown) => void) => {
        if (msg.type === 'GET_AUTH_STATUS') cb({ authenticated: false });
      },
    );

    mountSessionStatus(compose, toolbar, []);
    await vi.waitFor(() =>
      expect(toolbar.querySelector('[data-proofline-status-pill]')).not.toBeNull(),
    );

    const callsBefore = mockSendMessage.mock.calls.length;
    refreshSessionStatus(compose, ['new@recipient.com']);
    await vi.waitFor(() =>
      expect(mockSendMessage.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('is a no-op if no pill exists yet', () => {
    const compose = makeCompose();
    document.body.appendChild(compose);
    expect(() => refreshSessionStatus(compose, ['r@b.com'])).not.toThrow();
  });
});

// ─── mountWireFields ──────────────────────────────────────────────────────────

describe('mountWireFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('injects a wire instruction checkbox', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = toolbar.querySelector('[data-proofline-wire-checkbox]');
    expect(checkbox).not.toBeNull();
  });

  it('is idempotent — second call does not add a second checkbox', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);
    mountWireFields(compose, toolbar);

    const checkboxes = toolbar.querySelectorAll('[data-proofline-wire-checkbox]');
    expect(checkboxes.length).toBe(1);
  });

  it('wire panel is hidden by default', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const panel = toolbar.querySelector<HTMLElement>('[data-proofline-wire-panel]');
    expect(panel?.style.display).toBe('none');
  });

  it('panel appears when checkbox is checked', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = toolbar.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const panel = toolbar.querySelector<HTMLElement>('[data-proofline-wire-panel]');
    expect(panel?.style.display).not.toBe('none');
  });

  it('panel hides again when checkbox is unchecked', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = toolbar.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    const panel = toolbar.querySelector<HTMLElement>('[data-proofline-wire-panel]');
    expect(panel?.style.display).toBe('none');
  });
});

// ─── getWireState ─────────────────────────────────────────────────────────────

describe('getWireState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns isWireInstruction=false when not mounted', () => {
    const compose = makeCompose();
    document.body.appendChild(compose);
    const state = getWireState(compose);
    expect(state.isWireInstruction).toBe(false);
    expect(state.isHighValue).toBe(false);
    expect(state.isValid).toBe(true);
  });

  it('returns isWireInstruction=false when checkbox unchecked', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const state = getWireState(compose);
    expect(state.isWireInstruction).toBe(false);
  });

  it('returns isWireInstruction=true and isValid=false when checked but fields empty', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const state = getWireState(compose);
    expect(state.isWireInstruction).toBe(true);
    expect(state.isValid).toBe(false);
    expect(state.wirePayload).toBeUndefined();
  });

  it('returns valid wirePayload when all required fields are filled', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;

    amountEl.value  = '25000';
    accountEl.value = '123456789';
    routingEl.value = '021000021';

    const state = getWireState(compose);
    expect(state.isWireInstruction).toBe(true);
    expect(state.isValid).toBe(true);
    expect(state.wirePayload).toMatchObject({
      v: 1,
      amount: 25000,
      currency: 'USD',
      recipientAccount: '123456789',
      recipientRouting: '021000021',
    });
  });

  it('sets isHighValue=true when amount >= threshold', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;

    amountEl.value  = String(WIRE_HIGH_VALUE_THRESHOLD_USD);
    accountEl.value = '987654321';
    routingEl.value = '021000021';

    const state = getWireState(compose);
    expect(state.isHighValue).toBe(true);
  });

  it('sets isHighValue=false when amount is below threshold', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;

    amountEl.value  = String(WIRE_HIGH_VALUE_THRESHOLD_USD - 1);
    accountEl.value = '987654321';
    routingEl.value = '021000021';

    const state = getWireState(compose);
    expect(state.isHighValue).toBe(false);
  });

  it('includes memo in wirePayload when provided', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;
    const memoEl    = compose.querySelector<HTMLInputElement>('[data-wire-memo]')!;

    amountEl.value  = '1000';
    accountEl.value = '111222333';
    routingEl.value = '021000021';
    memoEl.value    = 'Invoice #42';

    const state = getWireState(compose);
    expect(state.wirePayload?.memo).toBe('Invoice #42');
  });

  it('rejects routing numbers that are not exactly 9 digits', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;

    amountEl.value  = '5000';
    accountEl.value = '111222333';
    routingEl.value = '12345';   // too short

    const state = getWireState(compose);
    expect(state.isValid).toBe(false);
    expect(state.wirePayload).toBeUndefined();
  });

  it('rejects negative amounts', () => {
    const compose = makeCompose();
    const toolbar = makeToolbar();
    compose.appendChild(toolbar);
    document.body.appendChild(compose);

    mountWireFields(compose, toolbar);

    const checkbox = compose.querySelector<HTMLInputElement>(
      '[data-proofline-wire-checkbox]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    const amountEl  = compose.querySelector<HTMLInputElement>('[data-wire-amount]')!;
    const accountEl = compose.querySelector<HTMLInputElement>('[data-wire-account]')!;
    const routingEl = compose.querySelector<HTMLInputElement>('[data-wire-routing]')!;

    amountEl.value  = '-500';
    accountEl.value = '111222333';
    routingEl.value = '021000021';

    const state = getWireState(compose);
    expect(state.isValid).toBe(false);
  });
});

// ─── WIRE_HIGH_VALUE_THRESHOLD_USD ────────────────────────────────────────────

describe('WIRE_HIGH_VALUE_THRESHOLD_USD', () => {
  it('equals 50000 per F-SES-07 default', () => {
    expect(WIRE_HIGH_VALUE_THRESHOLD_USD).toBe(50_000);
  });
});