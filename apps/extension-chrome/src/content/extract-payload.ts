// Extract the canonical email payload from a Gmail compose DOM.
//
// Trust model (TDD §3.3): the Gmail page DOM is UNTRUSTED. Every field
// is validated against zod before we hand it to the background SW.
// We read innerText (not innerHTML) so HTML wrappers Gmail adds for
// rich text don't bleed into the signed bytes — what the user sees
// is what gets signed.
//
// Page-level XSS in Gmail can manipulate the DOM here, but the user
// MUST confirm via biometric in the popup ceremony (PFL-044) before a
// signature is produced. The hash this module computes is the artifact
// the user is asked to confirm; tampering with the DOM after that point
// does not produce a valid signature.

import { EmailPayload } from '@proofline/types';
import type { PartialEmailPayload, ExtractError } from '../shared/types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type ExtractResult =
  | { ok: true; payload: PartialEmailPayload }
  | { ok: false; error: ExtractError };

// ─── Selector chains (primary → fallback → last-ditch) ────────────────────────

// Subject. Gmail's compose uses <input name="subjectbox"> consistently —
// the aria-label form is kept as a defensive fallback if Gmail ever drops
// the legacy attribute.
const SUBJECT_SELECTORS: readonly string[] = [
  'input[name="subjectbox"]',
  'input[aria-label="Subject"]',
];

// Message body editable. Confirmed against live Gmail DOM (May 10 2026):
// the body is a div with role="textbox", aria-label="Message Body",
// contenteditable="true" and g_editable="true". We use `*=` substring
// (case-insensitive) on aria-label so localized variants like "Cuerpo del
// mensaje" still match the secondary attribute fallbacks.
const BODY_SELECTORS: readonly string[] = [
  'div[role="textbox"][aria-label*="Message Body" i]',
  'div[g_editable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

// ─── Recipient chip selectors ────────────────────────────────────────────────
//
// Modern Gmail (2026) does NOT wrap recipient chips in a `role="listbox"`
// — the previous selector `div[role="listbox"][aria-label^="To" i] [email]`
// matched only the autocomplete suggestion popup, never the rendered chips,
// which is why extraction returned EMPTY_TO even with a valid To filled in.
//
// The actual structure looks like this (class names vary, semantic
// attributes do not):
//
//   <div class="agP aFw">              <!-- per-field recipient row -->
//     <div email="alice@example.com"   <!-- chip with email attribute -->
//          data-hovercard-id="alice@example.com"
//          role="option">…</div>
//     <input name="to" aria-label="To recipients" …>  <!-- editable input -->
//   </div>
//
// So we anchor on the field's input/textarea (matched by `name`= or
// aria-label starting with "To recipients"/"Cc recipients"/"Bcc recipients")
// and walk up to the smallest ancestor that contains chips with `[email]`
// — stopping if we cross into another field's input. A legacy listbox
// pattern is tried first so older Gmail builds (and our unit tests) still
// work without a code change.

type FieldName = 'to' | 'cc' | 'bcc';

const FIELD_PREFIX: Record<FieldName, string> = {
  to: 'To',
  cc: 'Cc',
  bcc: 'Bcc',
};

// Matches any recipient-field input across To/Cc/Bcc. Used to detect when
// ancestor traversal has crossed from one field into another so we don't
// attribute Cc chips to the To field.
const ANY_RECIPIENT_INPUT: string = [
  'input[name="to"]',
  'input[name="cc"]',
  'input[name="bcc"]',
  'textarea[name="to"]',
  'textarea[name="cc"]',
  'textarea[name="bcc"]',
  'input[aria-label^="To recipients" i]',
  'input[aria-label^="Cc recipients" i]',
  'input[aria-label^="Bcc recipients" i]',
  'textarea[aria-label^="To recipients" i]',
  'textarea[aria-label^="Cc recipients" i]',
  'textarea[aria-label^="Bcc recipients" i]',
].join(', ');

// Legacy / fixture compatibility: a labeled region or listbox dedicated
// to one field. `^=` (starts-with) — `*=` would let "Cc" match inside
// "Bcc" labels.
function regionSelector(field: FieldName): string {
  const prefix = FIELD_PREFIX[field];
  return [
    `[role="listbox"][aria-label^="${prefix}" i]`,
    `[role="region"][aria-label^="${prefix}" i]`,
  ].join(', ');
}

// The address input/textarea for this specific field. Modern Gmail uses
// either name= (legacy) or aria-label starting with "<Field> recipients".
function fieldInputSelector(field: FieldName): string {
  const prefix = FIELD_PREFIX[field];
  return [
    `input[name="${field}"]`,
    `textarea[name="${field}"]`,
    `input[aria-label^="${prefix} recipients" i]`,
    `textarea[aria-label^="${prefix} recipients" i]`,
  ].join(', ');
}

// ─── Field readers ────────────────────────────────────────────────────────────

function querySelectorChain(
  root: Element,
  selectors: readonly string[],
): Element | null {
  for (const sel of selectors) {
    const found = root.querySelector(sel);
    if (found) return found;
  }
  return null;
}

function readSubject(compose: Element): string | null {
  const el = querySelectorChain(compose, SUBJECT_SELECTORS);
  if (el && 'value' in el) {
    return String((el as HTMLInputElement).value ?? '');
  }
  return null;
}

function readBody(compose: Element): string | null {
  const el = querySelectorChain(compose, BODY_SELECTORS);
  if (!el) return null;
  // innerText, not innerHTML — what the user sees, no HTML wrapper.
  // jsdom doesn't fully implement innerText, so fall back to textContent.
  const innerText = (el as HTMLElement).innerText;
  if (typeof innerText === 'string' && innerText.length > 0) return innerText;
  return el.textContent ?? '';
}

function chipEmail(el: Element): string {
  // `email` attribute is authoritative; `data-hovercard-id` is a fallback
  // for older chip renderers that only emit the hovercard.
  return (
    el.getAttribute('email') ??
    el.getAttribute('data-hovercard-id') ??
    ''
  ).trim();
}

function collectChips(root: Element): string[] {
  const out: string[] = [];
  for (const chip of Array.from(root.querySelectorAll('[email]'))) {
    const value = chipEmail(chip);
    if (value) out.push(value);
  }
  return out;
}

function readChipAddresses(compose: Element, field: FieldName): string[] {
  // Strategy 1: a labeled region/listbox dedicated to this field. Covers
  // legacy Gmail builds (and our unit-test fixtures) where chips live
  // inside a `role="listbox"` / `role="region"` with aria-label="To"/etc.
  const region = compose.querySelector(regionSelector(field));
  if (region) {
    const chips = collectChips(region);
    if (chips.length > 0) return chips;
  }

  // Strategy 2: anchor on the field's address input/textarea and walk up
  // the parent chain. The first ancestor that (a) contains chips and (b)
  // does NOT contain a different field's input is the row container for
  // this field. We stop traversal the moment we'd cross into another
  // field's input — that guards against e.g. picking up Cc chips when
  // reading the To field.
  const input = compose.querySelector(fieldInputSelector(field));
  if (input) {
    let ancestor: Element | null = input.parentElement;
    while (ancestor && ancestor !== compose) {
      const otherInputs = ancestor.querySelectorAll(ANY_RECIPIENT_INPUT);
      // > 1 means this ancestor wraps multiple recipient inputs — we've
      // walked too far and would mix fields. Stop.
      if (otherInputs.length > 1) break;
      const chips = collectChips(ancestor);
      if (chips.length > 0) return chips;
      ancestor = ancestor.parentElement;
    }

    // Strategy 3 (last-ditch): no chips rendered yet (user is still
    // typing). Split the underlying input value on commas/semicolons.
    if ('value' in input) {
      const raw = String((input as HTMLInputElement).value ?? '');
      return raw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  return [];
}

function readThreadId(compose: Element): string | undefined {
  const explicit = compose.getAttribute('data-thread-id');
  if (explicit) return explicit;
  // Gmail puts thread ids in window.location.hash like `#inbox/<threadId>`.
  // Best-effort — return undefined if we can't find one.
  if (typeof window !== 'undefined' && window.location?.hash) {
    const m = window.location.hash.match(/\/([A-Za-z0-9_-]{8,})$/);
    if (m) return m[1];
  }
  return undefined;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

// Match @proofline/sessions recipient-set normalization: trim, lowercase,
// sort. We do NOT dedup here — that matches packages/sessions exactly so
// the canonical hash and recipientSetHash agree on the recipient list.
function normalizeAddresses(raw: string[]): string[] {
  return raw.map((s) => s.trim().toLowerCase()).sort();
}

function validateAddressList(
  raw: string[],
  field: 'to' | 'cc' | 'bcc',
): { ok: true; normalized: string[] } | { ok: false; error: ExtractError } {
  const normalized = normalizeAddresses(raw);
  for (const addr of normalized) {
    if (!EMAIL_RE.test(addr)) {
      return { ok: false, error: { code: 'INVALID_EMAIL', field, value: addr } };
    }
  }
  return { ok: true, normalized };
}

function snapshot(compose: Element): string {
  const html = (compose as HTMLElement).outerHTML ?? '';
  return html.length > 1024 ? html.slice(0, 1024) + '…' : html;
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export interface ExtractOptions {
  // Both injectable for deterministic tests. Default to real-world impls.
  now?: () => number;
  generateNonce?: () => string;
}

export function extractPayload(
  compose: Element,
  options?: ExtractOptions,
): ExtractResult {
  const now = options?.now ?? (() => Date.now());
  const generateNonce =
    options?.generateNonce ?? (() => crypto.randomUUID());

  const subjectMaybe = readSubject(compose);
  const bodyMaybe = readBody(compose);

  if (subjectMaybe === null && bodyMaybe === null) {
    return {
      ok: false,
      error: {
        code: 'DOM_UNEXPECTED',
        reason: 'no subject input and no body editable region matched',
        domSnapshot: snapshot(compose),
      },
    };
  }

  const subject = subjectMaybe ?? '';
  const body = bodyMaybe ?? '';

  const toRaw = readChipAddresses(compose, 'to');
  if (toRaw.length === 0) {
    return { ok: false, error: { code: 'EMPTY_TO' } };
  }
  const toResult = validateAddressList(toRaw, 'to');
  if (!toResult.ok) return toResult;

  const ccRaw = readChipAddresses(compose, 'cc');
  const ccResult = validateAddressList(ccRaw, 'cc');
  if (!ccResult.ok) return ccResult;

  const bccRaw = readChipAddresses(compose, 'bcc');
  const bccResult = validateAddressList(bccRaw, 'bcc');
  if (!bccResult.ok) return bccResult;

  const issuedAtMs = now();
  const issuedAt = Math.floor(issuedAtMs / 1000);
  const expiresAt = Math.floor((issuedAtMs + TWENTY_FOUR_HOURS_MS) / 1000);

  const candidate: PartialEmailPayload = {
    v: 1,
    to: toResult.normalized,
    cc: ccResult.normalized,
    bcc: bccResult.normalized,
    subject,
    body,
    threadId: readThreadId(compose),
    isWireInstruction: false,
    issuedAt,
    expiresAt,
    nonce: generateNonce(),
  };

  // Defense in depth: validate the partial payload against the full
  // EmailPayload schema with placeholder from/companyId, then strip the
  // placeholders before returning. If the schema rejects, the DOM gave
  // us something the rest of the pipeline can't sign.
  const validated = EmailPayload.safeParse({
    ...candidate,
    from: 'placeholder@proofline.local',
    companyId: 'placeholder',
  });
  if (!validated.success) {
    return {
      ok: false,
      error: {
        code: 'DOM_UNEXPECTED',
        reason: `zod validation failed: ${validated.error.issues.map((i) => i.path.join('.')).join(', ')}`,
        domSnapshot: snapshot(compose),
      },
    };
  }

  return { ok: true, payload: candidate };
}
