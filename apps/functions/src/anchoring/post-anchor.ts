/**
 * @file post-anchor.ts
 * @module apps/functions/src/anchoring
 *
 * Wraps an AnchorProvider call: posts the Merkle root on-chain, waits
 * for the receipt, writes a Firestore AnchorRecord, and marks the
 * batch's events anchored.
 *
 * Schema migration note (registry events):
 *   The spec ultimately wants `anchored: boolean, anchorRecordId?: string`
 *   on every registry-event-bearing collection (envelopes, role_credentials,
 *   revocations, etc.). Today, this codebase tracks unanchored work via the
 *   explicit `anchor_queue/` push collection (see signing.helpers.ts:235).
 *   AnchorStore.markEventsAnchored is therefore implemented (in service-factory)
 *   to drain anchor_queue entries; adding `anchored` fields to the source
 *   collections is deferred to a follow-up migration. The interface here is
 *   abstract so the migration won't require changes to scheduler/manual.
 *
 * Idempotency:
 *   On ALREADY_ANCHORED, we look up the existing AnchorRecord by root and
 *   return it. We still mark the batch's events anchored — this is the
 *   "retry succeeded but we lost the receipt last time" path.
 */

import type { AnchorProvider, Hex32, TxHash } from "@proofline/anchoring";
import type { BatchPlan } from "./batch.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnchorNetwork = "base-sepolia" | "base-mainnet";

export interface AnchorRecord {
  id:              string;
  sequence:        number;
  root:            Hex32;
  leafCount:       number;
  leaves:          Hex32[];
  txHash:          TxHash | string;
  blockNumber:     number;
  blockTimestamp:  number;
  postedAt:        number;
  network:         AnchorNetwork;
}

export type AnchorError =
  | { code: "CHAIN_TX_FAILED";    detail: string }
  | { code: "CHAIN_TIMEOUT";      detail: string }
  | { code: "ALREADY_ANCHORED";   existingRecordId: string }
  | { code: "STORE_WRITE_FAILED"; detail: string };

export type Result<T, E> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

export interface AnchorStore {
  getLatestSequence(): Promise<number>;
  /** Look up an existing record by Merkle root — for ALREADY_ANCHORED idempotency. */
  findAnchorRecordByRoot(root: Hex32): Promise<AnchorRecord | null>;
  writeAnchorRecord(rec: AnchorRecord): Promise<void>;
  markEventsAnchored(eventIds: string[], anchorRecordId: string): Promise<void>;
}

// Minimal observability shape — kept local so this file does not have to
// depend on @proofline/observability for the hackathon slice. A real
// ObservabilityProvider satisfies this trivially.
export interface AnchorLogger {
  captureError(err: Error, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void;
  log(level: "debug" | "info" | "warn" | "error", event: string, data?: Record<string, unknown>): void;
}

export interface PostAnchorDeps {
  anchor:  AnchorProvider;
  store:   AnchorStore;
  now:     () => number;
  logger:  AnchorLogger;
  /** Used to tag AnchorRecord.network. */
  network: AnchorNetwork;
  /** Generates a unique AnchorRecord id (default: 'anchor_' + random). */
  newId?:  () => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultNewId(): string {
  // Avoid pulling uuid in here for one call site — tx-hash-y short id is fine
  // because the AnchorRecord doc id is not user-facing.
  const rand = Math.random().toString(36).slice(2, 10);
  return `anchor_${Date.now().toString(36)}_${rand}`;
}

/** Best-effort detection of "root already anchored" reverts from viem/EVM. */
function isAlreadyAnchoredError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? "";
  return /already\s*anchored|already\s*posted|root\s*exists/i.test(msg);
}

function isTimeoutError(err: unknown): boolean {
  const msg  = (err as { message?: string })?.message ?? "";
  const name = (err as { name?:    string })?.name    ?? "";
  return /timeout|timed\s*out/i.test(msg) || /Timeout/i.test(name);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function postAnchorBatch(
  plan: BatchPlan,
  deps: PostAnchorDeps,
): Promise<Result<AnchorRecord, AnchorError>> {
  const newId = deps.newId ?? defaultNewId;

  // ── 1. Submit anchor on-chain ─────────────────────────────────────────────
  let receipt: Awaited<ReturnType<AnchorProvider["postAnchor"]>>;
  try {
    receipt = await deps.anchor.postAnchor(plan.root);
  } catch (err) {
    if (isAlreadyAnchoredError(err)) {
      // Idempotent retry: find the prior record and return it.
      const existing = await deps.store.findAnchorRecordByRoot(plan.root);
      if (existing) {
        // Still mark the batch's events anchored — they weren't last time.
        try {
          await deps.store.markEventsAnchored(plan.eventIds, existing.id);
        } catch (markErr) {
          deps.logger.captureError(markErr as Error, {
            tags:  { component: "post-anchor", phase: "mark-events-already-anchored" },
            extra: { recordId: existing.id, eventCount: plan.eventIds.length },
          });
          return {
            ok: false,
            error: { code: "STORE_WRITE_FAILED", detail: (markErr as Error).message },
          };
        }
        deps.logger.log("info", "anchor.already_anchored.reused", {
          recordId: existing.id,
          root:     plan.root,
        });
        return { ok: true, value: existing };
      }
      // We hit ALREADY_ANCHORED but have no local record — surface it
      // upward so the caller can decide. Return AnchorError.
      deps.logger.log("warn", "anchor.already_anchored.no_local_record", {
        root: plan.root,
      });
      return {
        ok: false,
        error: { code: "ALREADY_ANCHORED", existingRecordId: "" },
      };
    }

    if (isTimeoutError(err)) {
      deps.logger.captureError(err as Error, {
        tags: { component: "post-anchor", phase: "chain-timeout" },
      });
      return {
        ok: false,
        error: { code: "CHAIN_TIMEOUT", detail: (err as Error).message },
      };
    }

    deps.logger.captureError(err as Error, {
      tags: { component: "post-anchor", phase: "chain-tx-failed" },
    });
    return {
      ok: false,
      error: { code: "CHAIN_TX_FAILED", detail: (err as Error).message },
    };
  }

  // ── 2. Build AnchorRecord ─────────────────────────────────────────────────
  const record: AnchorRecord = {
    id:             newId(),
    sequence:       plan.sequence,
    root:           plan.root,
    leafCount:      plan.leafCount,
    leaves:         plan.leaves,
    txHash:         receipt.txHash,
    blockNumber:    Number(receipt.blockNumber),
    blockTimestamp: Number(receipt.timestamp),
    postedAt:       deps.now(),
    network:        deps.network,
  };

  // ── 3. Persist record + mark events anchored ─────────────────────────────
  try {
    await deps.store.writeAnchorRecord(record);
  } catch (err) {
    deps.logger.captureError(err as Error, {
      tags:  { component: "post-anchor", phase: "store-write-record" },
      extra: { recordId: record.id, root: record.root },
    });
    return {
      ok: false,
      error: { code: "STORE_WRITE_FAILED", detail: (err as Error).message },
    };
  }

  try {
    await deps.store.markEventsAnchored(plan.eventIds, record.id);
  } catch (err) {
    deps.logger.captureError(err as Error, {
      tags:  { component: "post-anchor", phase: "store-mark-events" },
      extra: { recordId: record.id, eventCount: plan.eventIds.length },
    });
    return {
      ok: false,
      error: { code: "STORE_WRITE_FAILED", detail: (err as Error).message },
    };
  }

  deps.logger.log("info", "anchor.posted", {
    recordId:    record.id,
    sequence:    record.sequence,
    root:        record.root,
    leafCount:   record.leafCount,
    txHash:      record.txHash,
    blockNumber: record.blockNumber,
    network:     record.network,
  });

  return { ok: true, value: record };
}
