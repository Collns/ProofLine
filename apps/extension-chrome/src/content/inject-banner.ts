/**
 * @file inject-banner.ts
 * @module apps/extension-chrome/src/content
 *
 * Inject (or replace) a ProofLine banner at the top of a Gmail compose
 * body after the popup ceremony returns the rendered HTML.
 *
 * Banner shape (PFL-040, rendered server-side by @proofline/email):
 *   <table data-proofline-banner="true" ...> ... </table>
 *
 * The banner is intentionally a self-contained inline-styled table so
 * it survives Gmail's HTML normalization on send and renders correctly
 * in any recipient's mail client. We do NOT touch styles or layout
 * here — we just place the snippet in the right DOM location.
 *
 * Re-injection rule: subsequent signs on the same compose REPLACE the
 * existing banner. The data-proofline-banner attribute is the unique
 * marker we look for.
 *
 * Reply-thread heuristic (per spec): if the compose body already
 * contains a quoted ProofLine signature from an earlier message in the
 * thread, we leave that quote alone — only the top-level (current)
 * banner is added/replaced. Quoted previous banners live inside Gmail's
 * `gmail_quote` block, so we scope insertion above that block.
 */

const BANNER_MARKER_ATTR = 'data-proofline-banner';
const QUOTE_SELECTOR = 'div.gmail_quote, blockquote.gmail_quote';

// Same selectors extract-payload.ts uses to find the body editable region.
const BODY_SELECTORS: readonly string[] = [
  'div[role="textbox"][aria-label*="Message Body" i]',
  'div[g_editable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

export interface InjectBannerResult {
  ok: true;
  replaced: boolean;
}

export interface InjectBannerFailure {
  ok: false;
  reason:
    | 'NO_BODY'
    | 'EMPTY_BANNER'
    | 'PARSE_FAILED';
}

export type InjectionResult = InjectBannerResult | InjectBannerFailure;

/**
 * Inject the rendered banner HTML at the top of a compose body. Returns
 * a structured result so callers can log diagnostics; never throws on
 * malformed inputs because banner injection is best-effort UX glue.
 */
export function injectBannerIntoCompose(
  composeElement: Element | null | undefined,
  bannerHtml: string,
): InjectionResult {
  if (!composeElement) return { ok: false, reason: 'NO_BODY' };
  const trimmed = (bannerHtml ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'EMPTY_BANNER' };

  const body = findComposeBody(composeElement);
  if (!body) return { ok: false, reason: 'NO_BODY' };

  const fragment = parseBannerFragment(trimmed);
  if (!fragment) return { ok: false, reason: 'PARSE_FAILED' };

  // If a banner is already in the compose, replace it in place.
  const existing = body.querySelector(`[${BANNER_MARKER_ATTR}="true"]`);
  if (existing) {
    existing.replaceWith(fragment);
    return { ok: true, replaced: true };
  }

  // No existing banner — insert at the top of the body, above any quote
  // block so the new banner is visually first.
  const quote = body.querySelector(QUOTE_SELECTOR);
  if (quote) {
    body.insertBefore(fragment, quote);
  } else {
    body.insertBefore(fragment, body.firstChild);
  }
  return { ok: true, replaced: false };
}

/**
 * Public alias matching the cross-component naming used by PFL-047
 * docs ("inject the banner into compose"). The orchestrator can call
 * either name; behaviour is identical.
 */
export const injectBanner = injectBannerIntoCompose;

// ─── Internals ────────────────────────────────────────────────────────────────

function findComposeBody(compose: Element): HTMLElement | null {
  for (const sel of BODY_SELECTORS) {
    const found = compose.querySelector(sel);
    if (found instanceof HTMLElement) return found;
  }
  // Last-ditch: the compose itself is a contenteditable.
  if (compose instanceof HTMLElement && compose.isContentEditable) {
    return compose;
  }
  return null;
}

/**
 * Parse the banner HTML and return its root element with the
 * data-proofline-banner attribute set so subsequent injections can
 * find and replace it. We use DOMParser to avoid creating an
 * intermediate <div> wrapper that would alter Gmail's send-time
 * HTML normalization.
 */
function parseBannerFragment(html: string): Element | null {
  if (typeof DOMParser === 'undefined') return null;

  // Wrap in a body — DOMParser('text/html') needs a full document.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return null;

  // Always mark — even if the upstream renderer forgot to set it.
  root.setAttribute(BANNER_MARKER_ATTR, 'true');
  // Defense in depth: tag a minimal, recognizable class so the banner
  // is greppable in send-time HTML for support diagnostics.
  if (!root.classList.contains('proofline-banner')) {
    root.classList.add('proofline-banner');
  }
  return root;
}
