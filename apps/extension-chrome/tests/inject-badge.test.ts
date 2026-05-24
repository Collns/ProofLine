/**
 * @file inject-badge.test.ts
 * @module apps/extension-chrome/tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectEnvelopeId, sweepInboundMessages } from '../src/content/inject-badge.js';
import { handleVerifyInbound, clearVerificationCache } from '../src/background/verify-inbound.js';

// ─── Minimal Chrome API mock ──────────────────────────────────────────────────

const mockSendMessage = vi.fn();

(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null,
    onMessage: { addListener: vi.fn() },
  },
};

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function makeMessageEl(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'adn ads';
  el.innerHTML = html;
  return el;
}

function makeBannerTable(envelopeId: string): string {
  return `<table data-proofline-banner="true" data-envelope-id="${envelopeId}">
    <tbody><tr><td>Verified by ProofLine</td></tr></tbody>
  </table>`;
}

function makeBannerComment(envelopeId: string): string {
  return `<!-- ProofLine-Banner-v1 -->
  <table data-envelope-id="${envelopeId}">
    <tbody><tr><td>Verified by ProofLine</td></tr></tbody>
  </table>
  <!-- /ProofLine-Banner-v1 -->`;
}

// ─── detectEnvelopeId ─────────────────────────────────────────────────────────

describe('detectEnvelopeId', () => {
  it('extracts id from data-proofline-banner attribute (strategy 1)', () => {
    const el = makeMessageEl(makeBannerTable('env-abc-123'));
    expect(detectEnvelopeId(el)).toBe('env-abc-123');
  });

  it('extracts id from HTML comment + sibling table (strategy 2)', () => {
    const el = makeMessageEl(makeBannerComment('env-xyz-456'));
    expect(detectEnvelopeId(el)).toBe('env-xyz-456');
  });

  it('returns null for a plain email with no ProofLine signature', () => {
    const el = makeMessageEl('<p>Hello, please wire $10,000 to routing 123456789.</p>');
    expect(detectEnvelopeId(el)).toBeNull();
  });

  it('returns null when banner table lacks data-envelope-id', () => {
    const el = makeMessageEl(`<table data-proofline-banner="true"></table>`);
    expect(detectEnvelopeId(el)).toBeNull();
  });

  it('trims whitespace from extracted id', () => {
    const el = makeMessageEl(`<table data-proofline-banner="true" data-envelope-id="  env-trim-789  "></table>`);
    expect(detectEnvelopeId(el)).toBe('env-trim-789');
  });

  it('prefers strategy 1 over strategy 2 when both are present', () => {
    const el = makeMessageEl(
      makeBannerTable('env-strategy-1') +
      makeBannerComment('env-strategy-2'),
    );
    expect(detectEnvelopeId(el)).toBe('env-strategy-1');
  });

  it('extracts from deeply nested banner table', () => {
    const el = makeMessageEl(
      `<div><div class="gmail_quote"><div>` +
      makeBannerTable('env-nested-deep') +
      `</div></div></div>`,
    );
    expect(detectEnvelopeId(el)).toBe('env-nested-deep');
  });
});

// ─── sweepInboundMessages ─────────────────────────────────────────────────────

describe('sweepInboundMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('sends VERIFY_INBOUND for a new unsigned message container', () => {
    const msg = makeMessageEl(makeBannerTable('env-new-001'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ type: 'VERIFY_RESULT', result: { ok: true, state: 'verified', signers: [], payload: {}, anchor: { root: '0x', blockNumber: '1', timestamp: '0' } } });
    });

    sweepInboundMessages(document);

    expect(mockSendMessage).toHaveBeenCalledWith(
      { type: 'VERIFY_INBOUND', envelopeId: 'env-new-001' },
      expect.any(Function),
    );
  });

  it('does not re-send VERIFY_INBOUND for an already-processed message', () => {
    const msg = makeMessageEl(makeBannerTable('env-processed-002'));
    msg.setAttribute('data-proofline-badge-state', 'verified');
    document.body.appendChild(msg);

    sweepInboundMessages(document);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not re-process a message in pending state', () => {
    const msg = makeMessageEl(makeBannerTable('env-pending-003'));
    msg.setAttribute('data-proofline-badge-state', 'pending');
    document.body.appendChild(msg);

    sweepInboundMessages(document);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('re-attempts messages in error state', () => {
    const msg = makeMessageEl(makeBannerTable('env-error-004'));
    msg.setAttribute('data-proofline-badge-state', 'error');
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ type: 'VERIFY_RESULT', result: { ok: false, state: 'rejected', code: 'PAYLOAD_HASH_MISMATCH', detail: '' } });
    });

    sweepInboundMessages(document);

    expect(mockSendMessage).toHaveBeenCalledWith(
      { type: 'VERIFY_INBOUND', envelopeId: 'env-error-004' },
      expect.any(Function),
    );
  });

  it('does not send for messages with no ProofLine signature', () => {
    const msg = makeMessageEl('<p>Regular unsigned email content.</p>');
    document.body.appendChild(msg);

    sweepInboundMessages(document);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sets badge state to pending before API call resolves', () => {
    const msg = makeMessageEl(makeBannerTable('env-pending-check-005'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation(() => { /* no callback — simulate in-flight */ });

    sweepInboundMessages(document);

    expect(msg.getAttribute('data-proofline-badge-state')).toBe('pending');
  });

  it('renders a chip in the message header after verification', () => {
    const msg = makeMessageEl(makeBannerTable('env-chip-006'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({
        type: 'VERIFY_RESULT',
        result: {
          ok: true,
          state: 'verified',
          signers: [{ userId: 'user-a', userDisplayName: 'Sarah Chen', companyLegalName: 'Acme Title LLC', signedAt: 1715040000 }],
          payload: {},
          anchor: { root: '0xabc', blockNumber: '12847392', timestamp: '1715040000' },
        },
      });
    });

    sweepInboundMessages(document);

    const chip = header.querySelector('[data-proofline-badge-chip]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-proofline-badge-chip')).toBe('verified');
    expect(chip?.textContent).toContain('Verified');
  });

  it('renders a Suspected Spoof chip for suspected_spoof state', () => {
    const msg = makeMessageEl(makeBannerTable('env-spoof-007'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({
        type: 'VERIFY_RESULT',
        result: {
          ok: true,
          state: 'suspected_spoof',
          claimedCompany: { companyId: 'acme', domain: 'acme-title.com', legalName: 'Acme Title LLC' },
          detail: 'Signature did not verify against public key.',
        },
      });
    });

    sweepInboundMessages(document);

    const chip = header.querySelector('[data-proofline-badge-chip]');
    expect(chip?.getAttribute('data-proofline-badge-chip')).toBe('suspected_spoof');
    expect(chip?.textContent).toContain('Suspected Spoof');
  });

  it('renders a Rejected chip for rejected state', () => {
    const msg = makeMessageEl(makeBannerTable('env-reject-008'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({
        type: 'VERIFY_RESULT',
        result: { ok: false, state: 'rejected', code: 'PAYLOAD_HASH_MISMATCH', detail: 'Hash mismatch.' },
      });
    });

    sweepInboundMessages(document);

    const chip = header.querySelector('[data-proofline-badge-chip]');
    expect(chip?.getAttribute('data-proofline-badge-chip')).toBe('rejected');
    expect(chip?.textContent).toContain('Rejected');
  });

  it('sets final badge state on message element after resolution', () => {
    const msg = makeMessageEl(makeBannerTable('env-state-009'));
    const header = document.createElement('div');
    header.className = 'gE iv gt';
    msg.appendChild(header);
    document.body.appendChild(msg);

    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({
        type: 'VERIFY_RESULT',
        result: {
          ok: true,
          state: 'bilateral',
          signers: [
            { userId: 'user-a', userDisplayName: 'Sarah Chen', companyLegalName: 'Acme', signedAt: 0 },
            { userId: 'user-b', userDisplayName: 'Mark Lim', companyLegalName: 'Scotiabank', signedAt: 0 },
          ],
          payload: {},
          anchor: { root: '0x', blockNumber: '1', timestamp: '0' },
        },
      });
    });

    sweepInboundMessages(document);

    expect(msg.getAttribute('data-proofline-badge-state')).toBe('bilateral');
  });
});

// ─── verify-inbound background handler ───────────────────────────────────────

describe('handleVerifyInbound', () => {
  beforeEach(() => {
    clearVerificationCache();
    vi.clearAllMocks();
  });

  it('returns false for non-VERIFY_INBOUND messages', () => {
    const sendResponse = vi.fn();
    const handled = handleVerifyInbound({ type: 'SIGN_EMAIL' }, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('returns true and responds with rejected for invalid envelopeId format', () => {
    const sendResponse = vi.fn();
    const handled = handleVerifyInbound(
      { type: 'VERIFY_INBOUND', envelopeId: 'bad id!' },
      sendResponse,
    );
    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      type: 'VERIFY_RESULT',
      result: expect.objectContaining({ state: 'rejected', code: 'INVALID_ID' }),
    });
  });

  it('fetches and caches result for valid envelopeId', async () => {
    const mockResponse = {
      ok: true,
      state: 'verified',
      signers: [],
      payload: {},
      anchor: { root: '0x', blockNumber: '1', timestamp: '0' },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as unknown as Response);

    const sendResponse = vi.fn();
    handleVerifyInbound({ type: 'VERIFY_INBOUND', envelopeId: 'validid12345678' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse).toHaveBeenCalledWith({
      type: 'VERIFY_RESULT',
      result: expect.objectContaining({ state: 'verified' }),
    });
  });

  it('returns cached result on second call without re-fetching', async () => {
    const mockResponse = { ok: true, state: 'verified', signers: [], payload: {}, anchor: { root: '0x', blockNumber: '1', timestamp: '0' } };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as unknown as Response);

    const send1 = vi.fn();
    const send2 = vi.fn();

    handleVerifyInbound({ type: 'VERIFY_INBOUND', envelopeId: 'cachedid12345' }, send1);
    await vi.waitFor(() => expect(send1).toHaveBeenCalled());

    handleVerifyInbound({ type: 'VERIFY_INBOUND', envelopeId: 'cachedid12345' }, send2);

    expect(send2).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles HTTP 400 as INVALID_ID rejection', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    } as unknown as Response);

    const sendResponse = vi.fn();
    handleVerifyInbound({ type: 'VERIFY_INBOUND', envelopeId: 'validid12345678' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      type: 'VERIFY_RESULT',
      result: expect.objectContaining({ code: 'INVALID_ID' }),
    });
  });

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ERR_NETWORK_CHANGED'));

    const sendResponse = vi.fn();
    handleVerifyInbound({ type: 'VERIFY_INBOUND', envelopeId: 'validid12345678' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      type: 'VERIFY_RESULT',
      result: expect.objectContaining({ code: 'NETWORK_ERROR' }),
    });
  });
});