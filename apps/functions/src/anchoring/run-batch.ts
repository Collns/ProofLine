/**
 * @file run-batch.ts
 * @module apps/functions/src/anchoring
 *
 * The shared "run one anchor cycle" function used by BOTH the scheduled
 * function (every 5 minutes) and the manual HTTP endpoint. Same code
 * path → same behavior for identical Firestore state.
 *
 * Returns a normalized RunResult so manual.ts can shape an HTTP response,
 * and the scheduler can log + drop.
 */

import { buildBatchPlan } from "./batch.js";
import type { RegistryEvent } from "./batch.js";
import { postAnchorBatch } from "./post-anchor.js";
import type {
  AnchorError,
  AnchorRecord,
  AnchorStore,
  AnchorLogger,
  AnchorNetwork,
} from "./post-anchor.js";
import type { AnchorProvider } from "@proofline/anchoring";

// ─── EventSource (kept abstract; Firestore impl is in service-factory.ts) ────

export interface EventSource {
  /**
   * Returns all unanchored RegistryEvents currently visible in the registry.
   * For the hackathon implementation this drains the `anchor_queue/` Firestore
   * collection. A future migration can switch this to `anchored=false` queries
   * across signed_messages / role_credentials / revocations without touching
   * the scheduler.
   */
  collectUnanchoredEvents(): Promise<RegistryEvent[]>;
}

export interface RunAnchorDeps {
  anchor:  AnchorProvider;
  store:   AnchorStore;
  source:  EventSource;
  network: AnchorNetwork;
  now:     () => number;
  logger:  AnchorLogger;
  newId?:  () => string;
}

// ─── Result shape ─────────────────────────────────────────────────────────────

export type RunResult =
  | { kind: "empty" }
  | { kind: "anchored"; record: AnchorRecord }
  | { kind: "failed";   error: AnchorError };

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAnchorBatchOnce(deps: RunAnchorDeps): Promise<RunResult> {
  const events = await deps.source.collectUnanchoredEvents();

  if (events.length === 0) {
    deps.logger.log("info", "anchor.run.empty", { events: 0 });
    return { kind: "empty" };
  }

  const latestSequence = await deps.store.getLatestSequence();
  const plan = buildBatchPlan({ events, latestSequence, now: deps.now() });

  // buildBatchPlan returns null only when events is empty — already short-circuited.
  if (!plan) return { kind: "empty" };

  deps.logger.log("info", "anchor.run.start", {
    leafCount: plan.leafCount,
    sequence:  plan.sequence,
  });

  const result = await postAnchorBatch(plan, {
    anchor:  deps.anchor,
    store:   deps.store,
    now:     deps.now,
    logger:  deps.logger,
    network: deps.network,
    newId:   deps.newId,
  });

  if (!result.ok) {
    deps.logger.log("error", "anchor.run.failed", {
      code:   result.error.code,
      detail: "detail" in result.error ? result.error.detail : undefined,
    });
    return { kind: "failed", error: result.error };
  }

  return { kind: "anchored", record: result.value };
}
