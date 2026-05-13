import { describe, it, expect } from 'vitest';
import { extractPayload } from '../src/content/extract-payload.js';
import { canonicalizeAndHash } from '../src/content/canonical-bridge.js';
import { handleMessage } from '../src/background/messages.js';
import type {
  BackgroundResponse,
  PartialEmailPayload,
} from '../src/shared/types.js';

// Builds a Gmail-shaped compose dialog with controllable subject, body,
// and chip lists. Returns the dialog element (already in document.body).
interface ComposeShape {
  subject?: string | null;             // null → omit subject input entirely
  body?: string | null;                // null → omit body div entirely
  bodyHtml?: string;                   // when set, body cell uses innerHTML
  to?: string[];
  cc?: string[];
  bcc?: string[];
  toFromInput?: string;                // last-ditch input fallback
}

function makeChipListbox(label: string, addresses: string[]): string {
  const chips = addresses
    .map((a) => `<span email="${a}" data-hovercard-id="${a}">${a}</span>`)
    .join('');
  return `<div role="listbox" aria-label="${label}">${chips}</div>`;
}

function buildCompose(shape: ComposeShape): HTMLElement {
  document.body.innerHTML = '';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'New Message');

  if (shape.subject !== null && shape.subject !== undefined) {
    const subj = document.createElement('input');
    subj.setAttribute('name', 'subjectbox');
    subj.value = shape.subject;
    dialog.appendChild(subj);
  }

  if (shape.body !== null && shape.body !== undefined) {
    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    if (shape.bodyHtml) {
      body.innerHTML = shape.bodyHtml;
    } else {
      body.textContent = shape.body;
    }
    dialog.appendChild(body);
  }

  if (shape.to && shape.to.length > 0) {
    dialog.insertAdjacentHTML('beforeend', makeChipListbox('To', shape.to));
  }
  if (shape.cc && shape.cc.length > 0) {
    dialog.insertAdjacentHTML('beforeend', makeChipListbox('Cc', shape.cc));
  }
  if (shape.bcc && shape.bcc.length > 0) {
    dialog.insertAdjacentHTML('beforeend', makeChipListbox('Bcc', shape.bcc));
  }
  if (shape.toFromInput) {
    const ta = document.createElement('textarea');
    ta.setAttribute('name', 'to');
    ta.value = shape.toFromInput;
    dialog.appendChild(ta);
  }

  document.body.appendChild(dialog);
  return dialog;
}

const fixedNow = () => 1_700_000_000_000;
const fixedNonce = () => 'aaaaaaaaaaaaaaaaaaaaaa';

describe('extractPayload — happy paths', () => {
  it('extracts subject, body, and a single To address', () => {
    const compose = buildCompose({
      subject: 'Hello',
      body: 'Hi there',
      to: ['alice@example.com'],
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.subject).toBe('Hello');
      expect(result.payload.body).toBe('Hi there');
      expect(result.payload.to).toEqual(['alice@example.com']);
      expect(result.payload.cc).toEqual([]);
      expect(result.payload.bcc).toEqual([]);
      expect(result.payload.v).toBe(1);
      expect(result.payload.isWireInstruction).toBe(false);
    }
  });

  it('lowercases and sorts multiple To addresses (matches sessions normalization)', () => {
    const compose = buildCompose({
      subject: 's',
      body: 'b',
      to: ['Bob@Example.com', 'alice@example.com', 'CHARLIE@example.com'],
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual([
        'alice@example.com',
        'bob@example.com',
        'charlie@example.com',
      ]);
    }
  });

  it('extracts To, Cc, and Bcc chips into separate fields', () => {
    const compose = buildCompose({
      subject: 's',
      body: 'b',
      to: ['alice@example.com'],
      cc: ['carol@example.com', 'dave@example.com'],
      bcc: ['eve@example.com'],
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['alice@example.com']);
      expect(result.payload.cc).toEqual(['carol@example.com', 'dave@example.com']);
      expect(result.payload.bcc).toEqual(['eve@example.com']);
    }
  });

  it('reads body as plain text — HTML tags do not survive', () => {
    const compose = buildCompose({
      subject: 's',
      body: 'fallback',
      bodyHtml: '<b>hi</b> world',
      to: ['alice@example.com'],
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // jsdom resolves textContent for <b>hi</b> world → "hi world"
      expect(result.payload.body).toBe('hi world');
      expect(result.payload.body).not.toContain('<b>');
      expect(result.payload.body).not.toContain('</b>');
    }
  });

  it('generates a unique nonce per call when no override is given', () => {
    const composeA = buildCompose({ subject: 's', body: 'b', to: ['alice@example.com'] });
    const a = extractPayload(composeA);
    const composeB = buildCompose({ subject: 's', body: 'b', to: ['alice@example.com'] });
    const b = extractPayload(composeB);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.payload.nonce).not.toBe(b.payload.nonce);
      expect(a.payload.nonce.length).toBeGreaterThanOrEqual(22);
    }
  });

  it('computes expiresAt = issuedAt + 24h', () => {
    const compose = buildCompose({
      subject: 's',
      body: 'b',
      to: ['alice@example.com'],
    });
    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ONE_DAY_SEC = 24 * 60 * 60;
      expect(result.payload.expiresAt - result.payload.issuedAt).toBe(ONE_DAY_SEC);
    }
  });
});

describe('canonicalize-bridge — hash determinism', () => {
  const basePayload: PartialEmailPayload = {
    v: 1,
    to: ['alice@example.com'],
    cc: [],
    bcc: [],
    subject: 'Hello',
    body: 'Hi there',
    isWireInstruction: false,
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_086_400,
    nonce: 'aaaaaaaaaaaaaaaaaaaaaa',
  };

  it('returns the same hash for the same payload', async () => {
    const a = await canonicalizeAndHash(basePayload);
    const b = await canonicalizeAndHash({ ...basePayload });
    expect(a.payloadHashHex).toBe(b.payloadHashHex);
    expect(a.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different hash when subject changes', async () => {
    const a = await canonicalizeAndHash(basePayload);
    const b = await canonicalizeAndHash({ ...basePayload, subject: 'Goodbye' });
    expect(a.payloadHashHex).not.toBe(b.payloadHashHex);
  });
});

describe('extractPayload — failure modes', () => {
  it('returns INVALID_EMAIL when a To entry is malformed', () => {
    const compose = buildCompose({
      subject: 's',
      body: 'b',
      to: ['not-an-email'],
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_EMAIL');
      if (result.error.code === 'INVALID_EMAIL') {
        expect(result.error.field).toBe('to');
        expect(result.error.value).toBe('not-an-email');
      }
    }
  });

  it('returns EMPTY_TO when no recipients are present', () => {
    const compose = buildCompose({
      subject: 'Hello',
      body: 'Hi',
    });

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EMPTY_TO');
    }
  });

  it('PFL-098: extracts the chipped recipient from a collapsed reply compose, ignoring the quoted blockquote', () => {
    // Simulates Gmail reply DOM with the recipients row collapsed:
    //   - NO role="listbox" / role="region" with aria-label="To"
    //   - NO input[name="to"] (would only appear after user clicks To)
    //   - One [email] chip in a bare header div
    //   - A blockquote.gmail_quote inside the body containing the
    //     prior message's From: chip — also [email]-attributed — which
    //     MUST NOT be picked up as a recipient of the reply.
    document.body.innerHTML = '';
    const reply = document.createElement('div');
    reply.setAttribute('role', 'dialog');
    reply.setAttribute('aria-label', 'Reply');

    const header = document.createElement('div');
    header.className = 'iw';     // arbitrary; mirrors Gmail's collapsed-row class shape
    const chip = document.createElement('span');
    chip.setAttribute('email', 'mark@scotiabank.com');
    chip.setAttribute('data-hovercard-id', 'mark@scotiabank.com');
    chip.textContent = 'Mark';
    header.appendChild(chip);
    reply.appendChild(header);

    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'Thanks Mark, see attached.';

    const quote = document.createElement('blockquote');
    quote.className = 'gmail_quote';
    const quotedFrom = document.createElement('span');
    quotedFrom.setAttribute('email', 'sarah@acme-title.com');
    quotedFrom.textContent = 'Sarah Chen';
    quote.appendChild(quotedFrom);
    body.appendChild(quote);
    reply.appendChild(body);

    document.body.appendChild(reply);

    const result = extractPayload(reply, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The chipped recipient is extracted.
      expect(result.payload.to).toEqual(['mark@scotiabank.com']);
      // The quoted From: chip is excluded — would otherwise pollute To.
      expect(result.payload.to).not.toContain('sarah@acme-title.com');
      expect(result.payload.body).toContain('Thanks Mark');
    }
  });

  it('PFL-098: extracts a mailto-only recipient from reply compose (no [email] chips at all)', () => {
    // Worst-case reply DOM: the recipient is rendered as plain
    // <a href="mailto:..."> without any [email] / data-hovercard-id
    // attributes. Strategy 4c should still find it.
    document.body.innerHTML = '';
    const reply = document.createElement('div');
    reply.setAttribute('role', 'dialog');

    const header = document.createElement('div');
    const link = document.createElement('a');
    link.setAttribute('href', 'mailto:mark@scotiabank.com');
    link.textContent = 'mark@scotiabank.com';
    header.appendChild(link);
    reply.appendChild(header);

    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'Reply body.';
    // Quoted block has its own mailto links — exclude these.
    const quote = document.createElement('blockquote');
    quote.className = 'gmail_quote';
    const noisy = document.createElement('a');
    noisy.setAttribute('href', 'mailto:sarah@acme-title.com');
    noisy.textContent = 'sarah@acme-title.com';
    quote.appendChild(noisy);
    body.appendChild(quote);
    reply.appendChild(body);

    document.body.appendChild(reply);

    const result = extractPayload(reply, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['mark@scotiabank.com']);
      expect(result.payload.to).not.toContain('sarah@acme-title.com');
    }
  });

  it('PFL-098: regression guard — fresh-compose Strategy 2 still wins when an input is present', () => {
    // When the user EXPANDS the reply's To row (or in a fresh compose),
    // an input[name="to"] is present alongside the chip. Strategy 2's
    // input-anchored ancestor walk must keep working and Strategy 4
    // must not run — otherwise we'd risk attributing chips from outside
    // the field row.
    document.body.innerHTML = '';
    const reply = document.createElement('div');
    reply.setAttribute('role', 'dialog');

    // Per-field row holding both the chip and the editable input —
    // matches the modern Gmail DOM the existing extractor docs.
    const row = document.createElement('div');
    row.className = 'agP aFw';
    const chip = document.createElement('div');
    chip.setAttribute('email', 'mark@scotiabank.com');
    chip.setAttribute('role', 'option');
    chip.textContent = 'Mark';
    row.appendChild(chip);
    const input = document.createElement('input');
    input.setAttribute('name', 'to');
    input.setAttribute('aria-label', 'To recipients');
    row.appendChild(input);
    reply.appendChild(row);

    // Body editable + a quoted block whose [email] chip MUST NOT leak in.
    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'body';
    const quote = document.createElement('blockquote');
    quote.className = 'gmail_quote';
    const noisy = document.createElement('span');
    noisy.setAttribute('email', 'leak@example.com');
    quote.appendChild(noisy);
    body.appendChild(quote);
    reply.appendChild(body);

    document.body.appendChild(reply);

    const result = extractPayload(reply, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['mark@scotiabank.com']);
      expect(result.payload.to).not.toContain('leak@example.com');
    }
  });

  it('returns DOM_UNEXPECTED when neither subject nor body matches any selector', () => {
    document.body.innerHTML = '';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'New Message');
    dialog.innerHTML = '<div class="totally-other-shape">no fields here</div>';
    document.body.appendChild(dialog);

    const result = extractPayload(dialog, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'DOM_UNEXPECTED') {
      expect(result.error.reason).toMatch(/no subject|matched/);
      expect(result.error.domSnapshot.length).toBeGreaterThan(0);
      expect(result.error.domSnapshot.length).toBeLessThanOrEqual(1024 + 1);
    } else {
      throw new Error(`expected DOM_UNEXPECTED, got ${JSON.stringify(result)}`);
    }
  });
});

describe('background message routing', () => {
  const fakeSender = {} as chrome.runtime.MessageSender;

  it('routes PAYLOAD_EXTRACTED to ack ok:true with stub:"extracted"', () => {
    const partial: PartialEmailPayload = {
      v: 1,
      to: ['alice@example.com'],
      cc: [],
      bcc: [],
      subject: 'Hello',
      body: 'Hi',
      isWireInstruction: false,
      issuedAt: 1_700_000_000,
      expiresAt: 1_700_086_400,
      nonce: 'aaaaaaaaaaaaaaaaaaaaaa',
    };
    const response = handleMessage(
      {
        type: 'PAYLOAD_EXTRACTED',
        composeId: 'draft-123',
        canonicalHashHex: 'a'.repeat(64),
        partialPayload: partial,
      },
      fakeSender,
    ) as BackgroundResponse;

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.stub).toBe('extracted');
      expect(response.receivedType).toBe('PAYLOAD_EXTRACTED');
    }
  });

  it('routes EXTRACTION_FAILED to ack ok:false carrying the error code', () => {
    const response = handleMessage(
      {
        type: 'EXTRACTION_FAILED',
        composeId: 'draft-123',
        error: { code: 'EMPTY_TO' },
      },
      fakeSender,
    ) as BackgroundResponse;

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('EMPTY_TO');
    }
  });
});
