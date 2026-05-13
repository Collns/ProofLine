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

  it('PFL-098.1: real bug — `compose` passed to extractPayload is a NARROW subtree that excludes the chip (chip is in a sibling subtree under role="region"[data-compose-id])', () => {
    // Reproduces the exact live failure mode. The content script's
    // `findInlineComposes` walks up from `tr.btC` to the smallest
    // ancestor that contains the body editable, then passes THAT
    // element to `extractPayload`. In Gmail inline reply, the chip
    // and the body+toolbar live in SIBLING subtrees under a wider
    // `[role="region"][data-compose-id]` container — so the compose
    // element extractPayload sees does NOT contain the chip at all.
    //
    // Strategy 4's `compose.querySelectorAll('[email]')` returns 0 →
    // EMPTY_TO. The fix is for Strategy 4 to walk up to the wider
    // `[role="region"][data-compose-id]` ancestor when nothing matches
    // in the narrow compose.
    document.body.innerHTML = '';

    // The wider role="region" container (what manual DevTools queries hit).
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('data-compose-id', '1');
    region.setAttribute('aria-label', 'Re:');

    // ── Sibling subtree A: recipients chip area
    const recipientsCell = document.createElement('td');
    recipientsCell.className = 'Iy';
    const chip = document.createElement('span');
    chip.setAttribute('email', 'danievwe@gmail.com');
    chip.textContent = 'danievwe@gmail.com';
    recipientsCell.appendChild(chip);
    region.appendChild(recipientsCell);

    // ── Sibling subtree B: the body+toolbar wrapper. This is the
    // element findInlineComposes returns as `compose`.
    const composeWrapper = document.createElement('div');
    composeWrapper.className = 'composeWrap';

    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'reply body';
    composeWrapper.appendChild(body);

    // Subject + toolbar (subject input must be inside `compose` so
    // extractPayload's subject reader doesn't fail at DOM_UNEXPECTED).
    const subj = document.createElement('input');
    subj.setAttribute('name', 'subjectbox');
    subj.value = 'Re: hello';
    composeWrapper.appendChild(subj);

    // The To input — Gmail also puts this in the body+toolbar wrapper
    // in some reply layouts, with hidden form mirrors elsewhere.
    const toInput = document.createElement('input');
    toInput.setAttribute('aria-label', 'To recipients');
    toInput.setAttribute('type', 'text');
    toInput.setAttribute('role', 'combobox');
    toInput.value = '';
    composeWrapper.appendChild(toInput);

    // Hidden form mirrors that trip Strategy 2's `otherInputs > 1` guard
    // so Strategy 4 actually gets a chance to run.
    for (const name of ['to', 'cc', 'bcc']) {
      const i = document.createElement('input');
      i.setAttribute('name', name);
      i.setAttribute('type', 'hidden');
      composeWrapper.appendChild(i);
    }

    region.appendChild(composeWrapper);
    document.body.appendChild(region);

    // Sanity: the chip is reachable from the wider region but NOT from
    // the narrow compose — this is precisely the live failure shape.
    expect(region.querySelectorAll('[email]')).toHaveLength(1);
    expect(composeWrapper.querySelectorAll('[email]')).toHaveLength(0);

    const result = extractPayload(composeWrapper, { now: fixedNow, generateNonce: fixedNonce });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['danievwe@gmail.com']);
    }
  });

  it('PFL-098.1 secondary: input + chip in separate subtrees WITHIN one compose (chip is reachable, sanity-check Strategy 2/4 still cooperate)', () => {
    // Faithful reproduction of the live Gmail inline-reply DOM that
    // PFL-098 was supposed to fix but didn't. Key features:
    //   - compose root has role="region" aria-label="Re:" (NOT "To" —
    //     so Strategy 1's regionSelector misses)
    //   - one <input aria-label="To recipients"> with empty value
    //     (Strategy 2 finds it, but its ancestor walk runs into hidden
    //     <input name="cc"> / <input name="bcc"> mirrors that Gmail
    //     keeps in the form, tripping the otherInputs.length > 1 break)
    //   - the actual recipient chip [email="…"] lives in a separate
    //     table subtree under the form
    //   - the form also contains body editable + a quoted blockquote
    //   - Strategy 4 MUST scan compose-wide and pick up the chip.
    document.body.innerHTML = '';
    const compose = document.createElement('div');
    compose.setAttribute('role', 'region');
    compose.setAttribute('data-compose-id', '1');
    compose.setAttribute('aria-label', 'Re:');

    const outerTable = document.createElement('table');
    outerTable.className = 'aoP HM';
    const outerTbody = document.createElement('tbody');
    const outerTr = document.createElement('tr');
    const outerTd = document.createElement('td');
    outerTd.className = 'I5';
    const form = document.createElement('form');
    form.className = 'bAs';

    // ── Chip subtree (mirrors the live path: SPAN -> DIV.oL.aDm.az9 ->
    // DIV.aoD.hl -> TD.Iy -> TR -> TBODY -> TABLE.IG). The chip and the
    // To input live in DIFFERENT subtrees under the form — sharing only
    // the form ancestor.
    const chipTable = document.createElement('table');
    chipTable.className = 'IG';
    const chipTbody = document.createElement('tbody');
    const chipTr = document.createElement('tr');
    const chipTd = document.createElement('td');
    chipTd.className = 'Iy';
    const chipWrap = document.createElement('div');
    chipWrap.className = 'aoD hl';
    const chipInner = document.createElement('div');
    chipInner.className = 'oL aDm az9';
    const chip = document.createElement('span');
    chip.setAttribute('email', 'danievwe@gmail.com');
    chip.textContent = 'danievwe@gmail.com';
    chipInner.appendChild(chip);
    chipWrap.appendChild(chipInner);
    chipTd.appendChild(chipWrap);
    chipTr.appendChild(chipTd);
    chipTbody.appendChild(chipTr);
    chipTable.appendChild(chipTbody);
    form.appendChild(chipTable);

    // ── To-input subtree — a sibling of the chip's table under the form,
    // so the smallest common ancestor of input + chip is the form itself.
    const inputTable = document.createElement('table');
    const inputTbody = document.createElement('tbody');
    const inputTr = document.createElement('tr');
    const inputTd = document.createElement('td');
    const toInput = document.createElement('input');
    toInput.id = ':9r';
    toInput.className = 'agP aFw';
    toInput.setAttribute('aria-label', 'To recipients');
    toInput.setAttribute('type', 'text');
    toInput.setAttribute('role', 'combobox');
    toInput.value = '';
    inputTd.appendChild(toInput);
    inputTr.appendChild(inputTd);
    inputTbody.appendChild(inputTr);
    inputTable.appendChild(inputTbody);
    form.appendChild(inputTable);

    // ── Hidden form mirror inputs Gmail keeps for all three fields, even
    // when only To is visible. These match ANY_RECIPIENT_INPUT and were
    // hypothesized to trip Strategy 2's `otherInputs.length > 1` guard.
    const hiddenTo = document.createElement('input');
    hiddenTo.setAttribute('name', 'to');
    hiddenTo.setAttribute('type', 'hidden');
    hiddenTo.value = '';
    form.appendChild(hiddenTo);
    const hiddenCc = document.createElement('input');
    hiddenCc.setAttribute('name', 'cc');
    hiddenCc.setAttribute('type', 'hidden');
    hiddenCc.value = '';
    form.appendChild(hiddenCc);
    const hiddenBcc = document.createElement('input');
    hiddenBcc.setAttribute('name', 'bcc');
    hiddenBcc.setAttribute('type', 'hidden');
    hiddenBcc.value = '';
    form.appendChild(hiddenBcc);

    const fromInput = document.createElement('input');
    fromInput.setAttribute('name', 'from');
    fromInput.setAttribute('type', 'hidden');
    fromInput.value = 'danievwe@gmail.com';
    form.appendChild(fromInput);

    // ── Body editable
    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'reply body';
    form.appendChild(body);

    outerTd.appendChild(form);
    outerTr.appendChild(outerTd);
    outerTbody.appendChild(outerTr);
    outerTable.appendChild(outerTbody);
    compose.appendChild(outerTable);
    document.body.appendChild(compose);

    const result = extractPayload(compose, { now: fixedNow, generateNonce: fixedNonce });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['danievwe@gmail.com']);
    }
  });

  it('PFL-098.2: Tier 3 — compose has NO ancestor [role="region"][data-compose-id]; chip is in a sibling-subtree region', () => {
    // Production failure shape PFL-098.1 did NOT cover:
    // `findInlineComposes` hands extractPayload a body+toolbar wrapper
    // that is a SIBLING (not a descendant) of the
    // [role="region"][data-compose-id] container holding the chip. Both
    // sit under some unattributed shared ancestor. PFL-098.1's
    // `.closest('[role="region"][data-compose-id]')` returns null → the
    // ancestor-region tier is skipped → we return EMPTY_TO even though
    // the chip is one ancestor-up + one subtree-over.
    //
    // Tier 3 walks up compose's parent chain and at each level scans
    // for [role="region"][data-compose-id] descendants that are NOT
    // ancestors of compose. First hit wins.
    document.body.innerHTML = '';

    // Shared ancestor — bare div, no compose-attribution semantics.
    const outer = document.createElement('div');
    outer.className = 'thread-container';

    // ── Sibling A: the [role="region"][data-compose-id] holding the chip.
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('data-compose-id', 'r99');
    region.setAttribute('aria-label', 'Re:');
    const chipCell = document.createElement('td');
    chipCell.className = 'Iy';
    const chip = document.createElement('span');
    chip.setAttribute('email', 'danievwe@gmail.com');
    chip.textContent = 'danievwe@gmail.com';
    chipCell.appendChild(chip);
    region.appendChild(chipCell);
    outer.appendChild(region);

    // ── Sibling B: the body+toolbar wrapper that findInlineComposes
    // returns as `compose`. NOT a descendant of `region`.
    const composeWrapper = document.createElement('div');
    composeWrapper.className = 'composeWrap';
    const subj = document.createElement('input');
    subj.setAttribute('name', 'subjectbox');
    subj.value = 'Re: hello';
    composeWrapper.appendChild(subj);
    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'reply body';
    composeWrapper.appendChild(body);
    const toInput = document.createElement('input');
    toInput.setAttribute('aria-label', 'To recipients');
    toInput.setAttribute('role', 'combobox');
    toInput.value = '';
    composeWrapper.appendChild(toInput);
    outer.appendChild(composeWrapper);

    document.body.appendChild(outer);

    // Sanity: compose has NO [role="region"][data-compose-id] ancestor.
    expect(composeWrapper.closest('[role="region"][data-compose-id]')).toBeNull();
    // …but the chip IS reachable from outer (one level above compose).
    expect(outer.querySelectorAll('[email]')).toHaveLength(1);
    expect(composeWrapper.querySelectorAll('[email]')).toHaveLength(0);

    const result = extractPayload(composeWrapper, { now: fixedNow, generateNonce: fixedNonce });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['danievwe@gmail.com']);
    }
  });

  it('PFL-098.2: Tier 3 does NOT pick up chips from another open compose region nearby', () => {
    // Guard against the obvious failure mode of Tier 3: if a user has
    // two reply composes open in the same thread, the sibling-region
    // walk could match the wrong region. Tier 3 stops at the first
    // ancestor level that exposes candidate regions — so chips from a
    // region two levels up (under a different shared ancestor) are NOT
    // confused with the active compose's chips.
    //
    // Layout:
    //   <document.body>
    //     <div.thread>
    //       <div.thread-pane-other>
    //         <div role="region" data-compose-id="other">
    //           <span email="wrong@example.com">  ← MUST NOT be picked up
    //     <div.active-thread>
    //       <div role="region" data-compose-id="active">
    //         <span email="right@example.com">
    //       <div.composeWrap>  ← passed to extractPayload
    document.body.innerHTML = '';
    const otherPane = document.createElement('div');
    otherPane.className = 'thread-pane-other';
    const otherRegion = document.createElement('div');
    otherRegion.setAttribute('role', 'region');
    otherRegion.setAttribute('data-compose-id', 'other');
    const otherChip = document.createElement('span');
    otherChip.setAttribute('email', 'wrong@example.com');
    otherChip.textContent = 'wrong';
    otherRegion.appendChild(otherChip);
    otherPane.appendChild(otherRegion);
    document.body.appendChild(otherPane);

    const active = document.createElement('div');
    active.className = 'active-thread';
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('data-compose-id', 'active');
    const chip = document.createElement('span');
    chip.setAttribute('email', 'right@example.com');
    chip.textContent = 'right';
    region.appendChild(chip);
    active.appendChild(region);

    const composeWrapper = document.createElement('div');
    composeWrapper.className = 'composeWrap';
    const subj = document.createElement('input');
    subj.setAttribute('name', 'subjectbox');
    subj.value = 'Re: hello';
    composeWrapper.appendChild(subj);
    const body = document.createElement('div');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Message Body');
    body.setAttribute('contenteditable', 'true');
    body.textContent = 'reply body';
    composeWrapper.appendChild(body);
    active.appendChild(composeWrapper);
    document.body.appendChild(active);

    const result = extractPayload(composeWrapper, { now: fixedNow, generateNonce: fixedNonce });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.to).toEqual(['right@example.com']);
      expect(result.payload.to).not.toContain('wrong@example.com');
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
