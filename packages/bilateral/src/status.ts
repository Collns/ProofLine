/**
 * @file status.ts
 * @module packages/bilateral/src
 *
 * Derives BilateralStatus purely from the event log.
 * No mutable status field — every call recomputes from events.
 */

import type { BilateralDocument, BilateralStatus } from './types.js';

/**
 * Derive the current status of a document from its event log and the
 * current wall-clock time (unix seconds).
 *
 * Transition table:
 *   []                          → DRAFT (no events yet — should not occur
 *                                  after draftDocument, kept for safety)
 *   [DRAFTED]                   → DRAFT
 *   [DRAFTED, DRAFTER_SIGNED]   → PENDING_COUNTERPARTY  (unless expired)
 *   [DRAFTED, DRAFTER_SIGNED,
 *    COUNTERPARTY_SIGNED]       → BILATERAL_SIGNED
 *   any + REVOKED               → REVOKED  (terminal, trumps expiry)
 *   PENDING_COUNTERPARTY
 *     + now > expiresAt         → EXPIRED
 */
export function deriveStatus(doc: BilateralDocument, nowSec: number): BilateralStatus {
  const { events, payload } = doc;

  // REVOKED is terminal — check first regardless of order.
  if (events.some((e) => e.kind === 'REVOKED')) {
    return 'REVOKED';
  }

  const hasDrafted           = events.some((e) => e.kind === 'DRAFTED');
  const hasDrafterSigned     = events.some((e) => e.kind === 'DRAFTER_SIGNED');
  const hasCounterpartySigned = events.some((e) => e.kind === 'COUNTERPARTY_SIGNED');

  if (!hasDrafted) {
    return 'DRAFT';
  }

  if (hasCounterpartySigned) {
    return 'BILATERAL_SIGNED';
  }

  if (hasDrafterSigned) {
    // Expiry applies once the drafter has signed and we're waiting on counterparty.
    if (nowSec > payload.expiresAt) {
      return 'EXPIRED';
    }
    return 'PENDING_COUNTERPARTY';
  }

  // Only DRAFTED event — still in DRAFT, expiry doesn't apply yet.
  return 'DRAFT';
}