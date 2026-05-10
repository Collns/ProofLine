import { describe, it, expect } from "vitest";

import { buildBatchPlan } from "../batch.js";
import type { RegistryEvent } from "../batch.js";
import type { Hex32 } from "@proofline/anchoring";

const H = (b: string): Hex32 => `0x${b.padEnd(64, "0")}` as Hex32;

const NOW = 1_700_000_000_000;

function evt(kind: RegistryEvent["kind"], id: string, h: string): RegistryEvent {
  return { kind, id, hash: H(h), createdAt: NOW };
}

describe("buildBatchPlan", () => {
  it("returns null for an empty event list", () => {
    const plan = buildBatchPlan({ events: [], latestSequence: 0, now: NOW });
    expect(plan).toBeNull();
  });

  it("builds a single-leaf tree where root === leaf hash", () => {
    const events = [evt("envelope", "e1", "aa")];
    const plan = buildBatchPlan({ events, latestSequence: 0, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan!.leafCount).toBe(1);
    expect(plan!.root).toBe(plan!.leaves[0]);
    expect(plan!.eventIds).toEqual(["e1"]);
  });

  it("derives a stable root for multiple events", () => {
    const events = [
      evt("envelope",        "e1", "aa"),
      evt("role_credential", "r1", "bb"),
      evt("envelope",        "e2", "cc"),
    ];
    const plan = buildBatchPlan({ events, latestSequence: 5, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan!.leafCount).toBe(3);
    expect(plan!.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plan!.sequence).toBe(6);
  });

  it("is deterministic across input order (3 permutations → same root)", () => {
    const a = evt("envelope",        "e1", "aa");
    const b = evt("role_credential", "r1", "bb");
    const c = evt("envelope",        "e2", "cc");

    const r1 = buildBatchPlan({ events: [a, b, c], latestSequence: 0, now: NOW })!.root;
    const r2 = buildBatchPlan({ events: [c, a, b], latestSequence: 0, now: NOW })!.root;
    const r3 = buildBatchPlan({ events: [b, c, a], latestSequence: 0, now: NOW })!.root;

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it("sequence derives from latestSequence + 1", () => {
    const events = [evt("envelope", "e1", "aa")];
    expect(buildBatchPlan({ events, latestSequence: 0,   now: NOW })!.sequence).toBe(1);
    expect(buildBatchPlan({ events, latestSequence: 41,  now: NOW })!.sequence).toBe(42);
    expect(buildBatchPlan({ events, latestSequence: 999, now: NOW })!.sequence).toBe(1000);
  });

  it("sorts leaves lexicographically by (kind, id) before hashing", () => {
    // Same hashes, but different (kind,id) pairs — verify the ORDER
    // of leaves in the plan reflects (kind, id) sort, not input order.
    const events = [
      evt("role_credential", "r1", "bb"),  // sorts second by kind
      evt("envelope",        "e2", "cc"),  // envelope < role_credential, e2
      evt("envelope",        "e1", "aa"),  // envelope < role_credential, e1
    ];
    const plan = buildBatchPlan({ events, latestSequence: 0, now: NOW })!;
    // Expected sorted order: envelope:e1, envelope:e2, role_credential:r1
    expect(plan.eventIds).toEqual(["e1", "e2", "r1"]);
    expect(plan.leaves).toEqual([H("aa"), H("cc"), H("bb")]);
  });

  it("rejects events with non-hex32 hashes", () => {
    const bad: RegistryEvent = {
      kind: "envelope",
      id: "e_bad",
      hash: "0xnothex" as Hex32,
      createdAt: NOW,
    };
    expect(() =>
      buildBatchPlan({ events: [bad], latestSequence: 0, now: NOW })
    ).toThrow(/invalid hash/i);

    const tooShort: RegistryEvent = {
      kind: "envelope",
      id: "e_short",
      hash: "0xaa" as Hex32,
      createdAt: NOW,
    };
    expect(() =>
      buildBatchPlan({ events: [tooShort], latestSequence: 0, now: NOW })
    ).toThrow(/invalid hash/i);
  });

  it("leafCount matches input event count", () => {
    const events = [
      evt("envelope",        "e1", "aa"),
      evt("envelope",        "e2", "bb"),
      evt("envelope",        "e3", "cc"),
      evt("role_credential", "r1", "dd"),
      evt("revocation",      "v1", "ee"),
    ];
    const plan = buildBatchPlan({ events, latestSequence: 0, now: NOW })!;
    expect(plan.leafCount).toBe(events.length);
    expect(plan.leaves.length).toBe(events.length);
    expect(plan.eventIds.length).toBe(events.length);
  });
});
