/**
 * @file screen.ts
 * @module packages/ai
 *
 * Screening is advisory, so a provider failure must never break signing.
 * screenSafely returns null (and reports why) instead of throwing; the
 * caller records "screening unavailable" rather than a clean result.
 */

import type { MemoScreener, ScreeningInput, ScreeningResult } from "./types.js";

export async function screenSafely(
  screener: MemoScreener,
  input: ScreeningInput,
  onError?: (err: unknown) => void,
): Promise<ScreeningResult | null> {
  try {
    return await screener.screen(input);
  } catch (err) {
    onError?.(err);
    return null;
  }
}
