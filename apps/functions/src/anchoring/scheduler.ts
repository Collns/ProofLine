/**
 * @file scheduler.ts
 * @module apps/functions/src/anchoring
 *
 * Firebase scheduled function — every 5 minutes, drain pending registry
 * events into a single Merkle batch and post on-chain (Base Sepolia).
 *
 * SLO (TDD §14.1): anchor confirmation lag < 10 min.
 *   5 min cadence + ~30 s tx confirmation = comfortably under SLO.
 *
 * On failure modes:
 *   CHAIN_TX_FAILED / CHAIN_TIMEOUT → log + return; events stay unanchored;
 *                                     next 5-min run retries naturally.
 *   ALREADY_ANCHORED                → events get marked anchored against
 *                                     the existing record; no error surfaced.
 *   STORE_WRITE_FAILED              → log; same retry logic as chain failures.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";

import { runAnchorBatchOnce } from "./run-batch.js";
import type { RunAnchorDeps } from "./run-batch.js";

// ─── Pure runner exported here for test reuse via run-batch.ts ────────────────

export type { RunAnchorDeps } from "./run-batch.js";
export { runAnchorBatchOnce } from "./run-batch.js";

// ─── Scheduled function (deps injected at deploy time via factory) ───────────

export function makeAnchorScheduler(deps: RunAnchorDeps) {
  return onSchedule(
    {
      schedule:   "every 5 minutes",
      timeZone:   "UTC",
      timeoutSeconds: 540,
      memory:     "512MiB",
      retryCount: 0, // we self-retry on the next tick; no double-anchor risk
    },
    async () => {
      await runAnchorBatchOnce(deps);
    },
  );
}
