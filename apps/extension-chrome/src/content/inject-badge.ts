/**
 * @file inject-badge.ts
 * @module apps/extension-chrome/src/content
 *
 * Inbound verification badge for ProofLine-signed emails (PFL-048).
 *
 * Flow:
 *   1. `sweepInboundMessages()` is called by the MutationObserver in index.ts
 *      whenever the Gmail DOM changes (SPA navigation, thread expansion, etc.).
 *   2. For each message container found, `detectEnvelopeId()` looks for:
 *        a. An existing `data-proofline-banner` table injected by the sender
 *           — parse its `data-envelope-id` attribute.
 *        b. The `<!-- ProofLine-Banner-v1 -->` HTML comment in the raw source
 *           — extract envelopeId from a `data-envelope-id` attribute on the
 *           table that follows the comment.
 *   3. If an envelope ID is found and we haven't already processed this
 *      message, send `VERIFY_INBOUND` to the background service worker.
 *   4. The background calls GET /v1/verify/{id} and responds with
 *      `VERIFY_RESULT`. We render the chip in the message header.
 *   5. Clicking the chip opens a sidebar panel with full signer detail.
 *
 * Idempotency: each message element is tagged with
 * `data-proofline-badge-state` so repeated sweeps skip already-processed
 * messages. A value of "pending" means the API call is in flight.
 *
 * Security: the DOM is untrusted. We only extract the envelopeId string
 * from the banner marker — we never trust any "verified" claim in the DOM.
 * The authoritative result always comes from the background → API call.
 */

import { log, warn } from '../shared/log.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Attribute set on the message container to track badge state. */
const BADGE_STATE_ATTR = 'data-proofline-badge-state';
/** Attribute on the sender-injected banner table holding the envelope id. */
const ENVELOPE_ID_ATTR = 'data-envelope-id';
/** HTML comment opening the sender-side banner. */
const BANNER_COMMENT = 'ProofLine-Banner-v1';
/** Attribute on the badge chip container for easy lookup. */
const BADGE_CHIP_ATTR = 'data-proofline-badge-chip';

/** Gmail message container selectors, ordered most-specific first. */
const MESSAGE_SELECTORS: readonly string[] = [
  // Expanded message in a thread
  'div.adn.ads',
  // Fallback: any expanded message body wrapper
  'div[data-message-id]',
];

/** Where in the message header we inject the chip. */
const HEADER_SELECTORS: readonly string[] = [
  // Standard Gmail message header row
  'div.gE.iv.gt',
  // Alternate header wrapper seen in some Gmail variants
  'div.ha h2',
  // Generic fallback: sender info row
  'div.iw',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type BadgeVerificationState =
  | 'verified'
  | 'bilateral'
  | 'suspected_spoof'
  | 'rejected'
  | 'pending'
  | 'error';

export interface VerificationResult {
  ok: boolean;
  state: 'verified' | 'bilateral' | 'suspected_spoof' | 'rejected' | 'unverified_sender';
  // verified / bilateral
  signers?: Array<{
    userId: string;
    userDisplayName?: string;
    role?: string;
    companyDomain?: string;
    companyLegalName?: string;
    signedAt?: number;
  }>;
  payload?: Record<string, unknown>;
  anchor?: {
    root: string;
    blockNumber: string;
    timestamp: string;
  };
  // suspected_spoof
  claimedCompany?: {
    companyId: string;
    domain: string;
    legalName: string;
  };
  detail?: string;
  // rejected
  code?: string;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Walk the given message container's DOM and extract a ProofLine envelope
 * ID if one is present. Returns null if the message was not signed with
 * ProofLine.
 *
 * Two detection strategies (in order):
 *   1. Sender banner table with `data-proofline-banner="true"` and
 *      `data-envelope-id` attribute.
 *   2. ProofLine-Banner-v1 HTML comment followed by a table with the
 *      same `data-envelope-id` attribute.
 */
export function detectEnvelopeId(messageEl: Element): string | null {
  // Strategy 1: already-parsed sender banner table
  const bannerTable = messageEl.querySelector(
    `[data-proofline-banner="true"][${ENVELOPE_ID_ATTR}]`,
  );
  if (bannerTable) {
    const id = bannerTable.getAttribute(ENVELOPE_ID_ATTR)?.trim();
    if (id) return id;
  }

  // Strategy 2: scan comment nodes in the message body looking for the
  // ProofLine-Banner-v1 marker, then grab the next sibling table's attribute.
  // Gmail sometimes re-renders the banner as plain text; we walk text nodes too.
  const id = extractEnvelopeIdFromComments(messageEl);
  if (id) return id;

  return null;
}

function extractEnvelopeIdFromComments(root: Element): string | null {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT,
    null,
  );

  let node: Node | null = walker.nextNode();
  while (node) {
    if (
      node.nodeType === Node.COMMENT_NODE &&
      node.nodeValue?.includes(BANNER_COMMENT)
    ) {
      // Found the opening comment — next sibling element should be the table
      let sibling = node.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          const el = sibling as Element;
          const id = el.getAttribute(ENVELOPE_ID_ATTR)?.trim()
            ?? el.querySelector(`[${ENVELOPE_ID_ATTR}]`)
                 ?.getAttribute(ENVELOPE_ID_ATTR)?.trim();
          if (id) return id;
          break;
        }
        sibling = sibling.nextSibling;
      }
    }
    node = walker.nextNode();
  }
  return null;
}

// ─── Sweep ────────────────────────────────────────────────────────────────────

/**
 * Called by the MutationObserver on every DOM change.
 * Finds expanded Gmail messages, checks for ProofLine signatures,
 * and kicks off verification for any not yet processed.
 */
export function sweepInboundMessages(doc: Document = document): void {
  const messages = findMessageContainers(doc);
  for (const msg of messages) {
    const state = msg.getAttribute(BADGE_STATE_ATTR);
    if (state && state !== 'error') {
      // Already processed or in-flight — skip.
      continue;
    }

    const envelopeId = detectEnvelopeId(msg);
    if (!envelopeId) continue;

    log('content', '[badge] envelope detected', envelopeId);
    msg.setAttribute(BADGE_STATE_ATTR, 'pending');
    renderPendingChip(msg);
    requestVerification(msg, envelopeId);
  }
}

function findMessageContainers(doc: Document): Element[] {
  for (const sel of MESSAGE_SELECTORS) {
    const found = Array.from(doc.querySelectorAll(sel));
    if (found.length > 0) return found;
  }
  return [];
}

// ─── Background communication ─────────────────────────────────────────────────

function requestVerification(messageEl: Element, envelopeId: string): void {
  chrome.runtime.sendMessage(
    { type: 'VERIFY_INBOUND', envelopeId },
    (response: { type: 'VERIFY_RESULT'; result: VerificationResult } | undefined) => {
      if (chrome.runtime.lastError) {
        warn('content', '[badge] runtime error', chrome.runtime.lastError.message);
        messageEl.setAttribute(BADGE_STATE_ATTR, 'error');
        renderBadgeChip(messageEl, 'error', null);
        return;
      }
      if (!response || response.type !== 'VERIFY_RESULT') {
        warn('content', '[badge] unexpected response', response);
        messageEl.setAttribute(BADGE_STATE_ATTR, 'error');
        renderBadgeChip(messageEl, 'error', null);
        return;
      }

      const { result } = response;
      const chipState = resolveChipState(result);
      messageEl.setAttribute(BADGE_STATE_ATTR, chipState);
      renderBadgeChip(messageEl, chipState, result);
      log('content', '[badge] rendered', chipState, envelopeId);
    },
  );
}

function resolveChipState(result: VerificationResult): BadgeVerificationState {
  if (!result.ok) return 'rejected';
  switch (result.state) {
    case 'verified':      return 'verified';
    case 'bilateral':     return 'bilateral';
    case 'suspected_spoof': return 'suspected_spoof';
    case 'rejected':      return 'rejected';
    default:              return 'error';
  }
}

// ─── Chip rendering ──────────────────────────────────────────────────────────

const CHIP_STYLES: Record<BadgeVerificationState, { bg: string; border: string; text: string; label: string; icon: string }> = {
  verified: {
    bg: '#f0fdf4',
    border: '#0F9D58',
    text: '#065f46',
    label: 'Verified',
    icon: '✓',
  },
  bilateral: {
    bg: '#ecfdf5',
    border: '#047857',
    text: '#064e3b',
    label: 'Bilateral',
    icon: '✓✓',
  },
  suspected_spoof: {
    bg: '#fef2f2',
    border: '#dc2626',
    text: '#7f1d1d',
    label: 'Suspected Spoof',
    icon: '⚠',
  },
  rejected: {
    bg: '#fef2f2',
    border: '#dc2626',
    text: '#7f1d1d',
    label: 'Rejected',
    icon: '✕',
  },
  pending: {
    bg: '#f9fafb',
    border: '#9ca3af',
    text: '#6b7280',
    label: 'Verifying…',
    icon: '○',
  },
  error: {
    bg: '#f9fafb',
    border: '#9ca3af',
    text: '#6b7280',
    label: 'Verification unavailable',
    icon: '○',
  },
};

function renderPendingChip(messageEl: Element): void {
  renderBadgeChip(messageEl, 'pending', null);
}

function renderBadgeChip(
  messageEl: Element,
  state: BadgeVerificationState,
  result: VerificationResult | null,
): void {
  const headerEl = findHeaderEl(messageEl);
  if (!headerEl) {
    warn('content', '[badge] header not found — cannot inject chip');
    return;
  }

  // Remove any existing chip (re-render on state change)
  const existing = headerEl.querySelector(`[${BADGE_CHIP_ATTR}]`);
  existing?.remove();
  const existingSidebar = messageEl.querySelector('[data-proofline-sidebar]');
  existingSidebar?.remove();

  const style = CHIP_STYLES[state];

  const chip = document.createElement('span');
  chip.setAttribute(BADGE_CHIP_ATTR, state);
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-label', `ProofLine: ${style.label}. Click for details.`);
  chip.style.cssText = [
    `display:inline-flex`,
    `align-items:center`,
    `gap:4px`,
    `padding:2px 8px`,
    `border-radius:12px`,
    `border:1.5px solid ${style.border}`,
    `background:${style.bg}`,
    `color:${style.text}`,
    `font-size:11px`,
    `font-weight:700`,
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`,
    `letter-spacing:0.03em`,
    `cursor:pointer`,
    `vertical-align:middle`,
    `margin-left:8px`,
    `line-height:1.4`,
    `text-decoration:none`,
    `user-select:none`,
    `transition:opacity 0.15s`,
  ].join(';');

  chip.innerHTML =
    `<span aria-hidden="true" style="font-size:10px">${style.icon}</span>` +
    `<span>ProofLine · ${style.label}</span>`;

  chip.addEventListener('mouseenter', () => { chip.style.opacity = '0.8'; });
  chip.addEventListener('mouseleave', () => { chip.style.opacity = '1'; });
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar(messageEl, state, result);
  });
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSidebar(messageEl, state, result);
    }
  });

  headerEl.appendChild(chip);
}

function findHeaderEl(messageEl: Element): Element | null {
  for (const sel of HEADER_SELECTORS) {
    const el = messageEl.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function toggleSidebar(
  messageEl: Element,
  state: BadgeVerificationState,
  result: VerificationResult | null,
): void {
  const existing = messageEl.querySelector('[data-proofline-sidebar]');
  if (existing) {
    existing.remove();
    return;
  }
  renderSidebar(messageEl, state, result);
}

function renderSidebar(
  messageEl: Element,
  state: BadgeVerificationState,
  result: VerificationResult | null,
): void {
  const style = CHIP_STYLES[state];

  const panel = document.createElement('div');
  panel.setAttribute('data-proofline-sidebar', 'true');
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'ProofLine verification detail');
  panel.style.cssText = [
    `margin:8px 0 0 0`,
    `padding:12px 16px`,
    `border-radius:8px`,
    `border-left:3px solid ${style.border}`,
    `background:${style.bg}`,
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`,
    `font-size:12px`,
    `color:#1f2937`,
    `line-height:1.5`,
  ].join(';');

  panel.innerHTML = buildSidebarHTML(state, result);

  // Close button
  const closeBtn = panel.querySelector('[data-sidebar-close]');
  closeBtn?.addEventListener('click', () => panel.remove());

  // Append after the header area
  const header = findHeaderEl(messageEl);
  if (header?.parentElement) {
    header.parentElement.insertBefore(panel, header.nextSibling);
  } else {
    messageEl.appendChild(panel);
  }
}

function buildSidebarHTML(state: BadgeVerificationState, result: VerificationResult | null): string {
  const style = CHIP_STYLES[state];
  const titleColor = style.text;

  let body = '';

  if (state === 'verified' || state === 'bilateral') {
    const signers = result?.signers ?? [];
    const signerRows = signers.map(s => {
      const ts = s.signedAt ? new Date(s.signedAt * 1000).toLocaleString() : '';
      const name = escapeHtml(s.userDisplayName ?? s.userId);
      const company = escapeHtml(s.companyLegalName ?? s.companyDomain ?? '');
      const role = escapeHtml(s.role ?? '');
      return `
        <div style="margin-top:8px;padding:8px;background:white;border-radius:6px;border:1px solid #e5e7eb">
          <div style="font-weight:700;color:#111827">${name}</div>
          ${company ? `<div style="color:#6b7280">${company}${role ? ` · ${role}` : ''}</div>` : ''}
          ${ts ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">Signed ${ts}</div>` : ''}
        </div>`;
    }).join('');

    const anchor = result?.anchor;
    const anchorRow = anchor
      ? `<div style="margin-top:8px;font-size:11px;color:#6b7280">
           Anchored on Base · block ${escapeHtml(anchor.blockNumber)}
         </div>`
      : '';

    body = `
      <div style="font-weight:800;color:${titleColor};font-size:13px;margin-bottom:4px">
        ${style.icon} ProofLine · ${style.label}
      </div>
      <div style="color:#374151">${signers.length} signer${signers.length !== 1 ? 's' : ''}</div>
      ${signerRows}
      ${anchorRow}`;
  } else if (state === 'suspected_spoof') {
    const company = result?.claimedCompany;
    const companyLine = company
      ? `<div style="margin-top:6px;color:#374151">Claimed domain: <strong>${escapeHtml(company.domain)}</strong></div>`
      : '';
    const detail = result?.detail ? `<div style="margin-top:4px;color:#6b7280;font-size:11px">${escapeHtml(result.detail)}</div>` : '';
    body = `
      <div style="font-weight:800;color:${titleColor};font-size:13px">
        ⚠ Suspected Spoof
      </div>
      <div style="margin-top:4px;color:#374151">This domain is registered on ProofLine but this message was <strong>not signed</strong> or the signature is invalid. Treat with extreme caution.</div>
      ${companyLine}${detail}`;
  } else if (state === 'rejected') {
    const code = result?.code ?? '';
    const detail = result?.detail ?? '';
    body = `
      <div style="font-weight:800;color:${titleColor};font-size:13px">✕ Verification Rejected</div>
      <div style="margin-top:4px;color:#374151">${code ? `Code: <code style="font-size:11px">${escapeHtml(code)}</code>` : 'This message failed ProofLine verification.'}</div>
      ${detail ? `<div style="margin-top:4px;color:#6b7280;font-size:11px">${escapeHtml(detail)}</div>` : ''}`;
  } else {
    body = `<div style="color:#6b7280">ProofLine verification status is unavailable.</div>`;
  }

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1">${body}</div>
      <button data-sidebar-close aria-label="Close ProofLine detail"
        style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:0 0 0 8px;flex-shrink:0">×</button>
    </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}