/**
 * @file batch.ts
 * @module apps/functions/src/anchoring
 *
 * Pure logic: given a list of unanchored RegistryEvents, build a Merkle
 * tree, derive the root, return a BatchPlan ready for postAnchorBatch.
 *
 * Determinism: same input set in any order produces the same root.
 * Achieved by sorting events by (kind, id) before hashing.
 *
 * Boundary cases:
 *   - Empty event list → returns null (caller short-circuits).
 *   - Non-Hex32 event hash → throws (validated up front).
 */

import { buildMerkleTree } from "@proofline/anchoring";
import type { Hex32, MerkleTree } from "@proofline/anchoring";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegistryEventKind =
  | "envelope"
  | "role_credential"
  | "revocation"
  | "company"
  | "session_revoke";

export interface RegistryEvent {
  kind:      RegistryEventKind;
  id:        string;
  hash:      Hex32;
  createdAt: number;
}

export interface BatchPlan {
  root:       Hex32;
  leafCount:  number;
  leaves:     Hex32[];
  tree:       MerkleTree;
  /** Monotonic, derived as latestSequence + 1 by the caller. */
  sequence:   number;
  plannedAt:  number;
  /** Event ids included in this batch — for markEventsAnchored. */
  eventIds:   string[];
}

export interface BuildBatchInputs {
  events:         RegistryEvent[];
  latestSequence: number;
  now:            number;
}

// ─── Hex32 validation ─────────────────────────────────────────────────────────

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

function isHex32(s: string): s is Hex32 {
  return HEX32_RE.test(s);
}

// ─── Pure builder ─────────────────────────────────────────────────────────────

export function buildBatchPlan(input: BuildBatchInputs): BatchPlan | null {
  const { events, latestSequence, now } = input;

  if (events.length === 0) return null;

  for (const ev of events) {
    if (!isHex32(ev.hash)) {
      throw new Error(
        `RegistryEvent ${ev.kind}:${ev.id} has invalid hash (expected 0x + 64 hex chars): ${ev.hash}`
      );
    }
  }

  // Sort for determinism — same set in any order produces same root.
  const sorted = [...events].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.id   !== b.id)   return a.id   < b.id   ? -1 : 1;
    return 0;
  });

  const leaves: Hex32[] = sorted.map((ev) => ev.hash);
  const tree = buildMerkleTree(leaves);

  return {
    root:      tree.root,
    leafCount: leaves.length,
    leaves,
    tree,
    sequence:  latestSequence + 1,
    plannedAt: now,
    eventIds:  sorted.map((ev) => ev.id),
  };
}
