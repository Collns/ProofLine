/**
 * @file unsigned-footer.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-190 — the recipient-facing footer on UNSIGNED outbound email.
 *
 * When the company policy has `appendUnsignedFooter` on (default), an unsigned
 * send gets a small inline-styled line appended to the body at the moment of
 * send: "This email was sent without a ProofLine signature."
 *
 * Rules, all enforced here:
 *   - Inserted ONLY at the moment of an unsigned send (see send-guard
 *     onSendAllowed). Signed emails never reach that path, so they never get
 *     the footer.
 *   - Never inside quoted reply/forward text: it is placed immediately BEFORE
 *     Gmail's `.gmail_quote` block when one exists, otherwise appended to the
 *     end of the body.
 *   - Idempotent: a second insertion on the same body is a no-op, so a resend
 *     can't duplicate it.
 *   - Removable: the Sign button strips any stray footer before building a
 *     payload, so it can never land in a later signature (the body text is
 *     read via innerText, which would otherwise include it).
 */

export const UNSIGNED_FOOTER_ATTR = 'data-proofline-unsigned-footer';
export const UNSIGNED_FOOTER_TEXT = 'This email was sent without a ProofLine signature.';

const BODY_SELECTOR = '[contenteditable="true"], [role="textbox"], [g_editable="true"]';
const QUOTE_SELECTOR = '.gmail_quote, blockquote.gmail_quote';

function findBody(compose: Element): HTMLElement | null {
  return compose.querySelector<HTMLElement>(BODY_SELECTOR);
}

/** True if this compose body already carries the ProofLine unsigned footer. */
export function hasUnsignedFooter(compose: Element): boolean {
  const body = findBody(compose);
  return !!body?.querySelector(`[${UNSIGNED_FOOTER_ATTR}]`);
}

/**
 * Appends the unsigned-send footer to the compose body. Returns true when a
 * footer was newly inserted, false when there is no body or one is already
 * present (so callers can record whether the footer actually went on).
 */
export function insertUnsignedFooter(compose: Element): boolean {
  const body = findBody(compose);
  if (!body) return false;
  if (body.querySelector(`[${UNSIGNED_FOOTER_ATTR}]`)) return false; // never duplicate

  const footer = document.createElement('div');
  footer.setAttribute(UNSIGNED_FOOTER_ATTR, 'true');
  footer.style.cssText = 'margin-top:12px;color:#6b7280;font-size:12px;';
  footer.textContent = UNSIGNED_FOOTER_TEXT;

  // Keep it OUT of quoted reply/forward text: place it just before the quote
  // block. In a fresh compose there is no quote, so append to the body end.
  const quote = body.querySelector(QUOTE_SELECTOR);
  if (quote?.parentElement) {
    quote.parentElement.insertBefore(footer, quote);
  } else {
    body.appendChild(footer);
  }
  return true;
}

/**
 * Removes any ProofLine unsigned footer from the compose body. Called by the
 * Sign button before extracting the payload, so a footer left by an earlier
 * unsigned-send attempt can never be folded into a signature. No-op when none
 * is present.
 */
export function removeUnsignedFooter(compose: Element): void {
  findBody(compose)
    ?.querySelectorAll(`[${UNSIGNED_FOOTER_ATTR}]`)
    .forEach((el) => el.remove());
}
