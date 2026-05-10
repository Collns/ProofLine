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

const SUBJECT_SELECTORS: readonly string[] = [
  'input[name="subjectbox"]',
  'input[aria-label="Subject"]',
];

const BODY_SELECTORS: readonly string[] = [
  'div[role="textbox"][aria-label*="Message Body" i]',
  'div[g_editable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

interface ChipFieldSelectors {
  primary: string;
  // Last-ditch: read the underlying address-input value if no chips
  // have been rendered yet (user is still typing).
  inputFallback: string;
}

// `^=` (starts-with) rather than `*=` (substring) — substring would let
// the Cc selector pick up chips inside an aria-label="Bcc..." listbox.
const TO_SELECTORS: ChipFieldSelectors = {
  primary: 'div[role="listbox"][aria-label^="To" i] [email]',
  inputFallback: 'input[aria-label^="To" i], textarea[name="to"]',
};
const CC_SELECTORS: ChipFieldSelectors = {
  primary: 'div[role="listbox"][aria-label^="Cc" i] [email]',
  inputFallback: 'input[aria-label^="Cc" i], textarea[name="cc"]',
};
const BCC_SELECTORS: ChipFieldSelectors = {
  primary: 'div[role="listbox"][aria-label^="Bcc" i] [email]',
  inputFallback: 'input[aria-label^="Bcc" i], textarea[name="bcc"]',
};

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

function readChipAddresses(compose: Element, sel: ChipFieldSelectors): string[] {
  const out: string[] = [];

  // Primary: rendered chips with [email] / [data-hovercard-id] attributes.
  const chips = compose.querySelectorAll(sel.primary);
  for (const chip of Array.from(chips)) {
    const fromEmailAttr = chip.getAttribute('email');
    const fromHovercard = chip.getAttribute('data-hovercard-id');
    const value = (fromEmailAttr ?? fromHovercard ?? '').trim();
    if (value) out.push(value);
  }
  if (out.length > 0) return out;

  // Last-ditch: split the underlying input/textarea value on commas.
  const input = compose.querySelector(sel.inputFallback);
  if (input && 'value' in input) {
    const raw = String((input as HTMLInputElement).value ?? '');
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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

  const toRaw = readChipAddresses(compose, TO_SELECTORS);
  if (toRaw.length === 0) {
    return { ok: false, error: { code: 'EMPTY_TO' } };
  }
  const toResult = validateAddressList(toRaw, 'to');
  if (!toResult.ok) return toResult;

  const ccRaw = readChipAddresses(compose, CC_SELECTORS);
  const ccResult = validateAddressList(ccRaw, 'cc');
  if (!ccResult.ok) return ccResult;

  const bccRaw = readChipAddresses(compose, BCC_SELECTORS);
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
