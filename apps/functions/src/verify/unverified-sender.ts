/**
 * @file unverified-sender.ts
 * @module apps/functions/src/verify
 *
 * Returns the "unverified_sender" response shape directly.
 *
 * Trivial today, but giving it its own module keeps the handler clean
 * and lets us add fields here later (e.g., a hint pointing the user at
 * onboarding) without touching the handler.
 */

import type { VerificationResponse } from "./contract.js";

export function unverifiedSenderResponse(): VerificationResponse {
  return { ok: true, state: "unverified_sender" };
}
