import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

import type { Hex32, AnchorReceipt, MerkleProof, AnchorProvider } from "@proofline/anchoring";

import { makeAnchorAdminRouter } from "../manual.js";
import {
  makeInMemoryAnchorStore,
  makeInMemoryEventSource,
  makeConsoleLogger,
} from "../service-factory.js";
import type { RegistryEvent } from "../batch.js";
import type { RunAnchorDeps } from "../run-batch.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const H = (b: string): Hex32 => `0x${b.padEnd(64, "0")}` as Hex32;
const TX = `0x${"f".repeat(64)}` as Hex32;
const NOW = 1_700_000_000_000;

function evt(id: string, h: string): RegistryEvent {
  return { kind: "envelope", id, hash: H(h), createdAt: NOW };
}

function makeStubAnchor(over: Partial<AnchorProvider> = {}): AnchorProvider {
  return {
    buildTree: () => ({ root: H("aa"), leaves: [], proofFor: () => null }),
    postAnchor: vi.fn(async (root: Hex32): Promise<AnchorReceipt> => ({
      root,
      txHash:      TX,
      blockNumber: 100n,
      timestamp:   1_700_000_001n,
    })),
    readAnchor:  async () => null,
    verifyProof: (_l: Hex32, _p: MerkleProof, _r: Hex32) => true,
    ...over,
  };
}

function buildApp(deps: RunAnchorDeps) {
  const app = (express as any)();
  app.use(express.json());
  app.use("/v1/admin/anchor", makeAnchorAdminRouter(deps));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /v1/admin/anchor/run — empty registry", () => {
  it("returns 200 with leafCount=0 and 'no events to anchor'", async () => {
    const deps: RunAnchorDeps = {
      anchor:  makeStubAnchor(),
      store:   makeInMemoryAnchorStore(),
      source:  makeInMemoryEventSource([]),
      network: "base-sepolia",
      now:     () => NOW,
      logger:  makeConsoleLogger(),
    };
    const res = await request(buildApp(deps)).post("/v1/admin/anchor/run");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok:        true,
      message:   "no events to anchor",
      leafCount: 0,
    });
  });
});

describe("POST /v1/admin/anchor/run — events present", () => {
  it("returns 200 with recordId, sequence, root, txHash, leafCount", async () => {
    const events = [evt("e1", "aa"), evt("e2", "bb"), evt("e3", "cc")];
    const store  = makeInMemoryAnchorStore();
    const deps: RunAnchorDeps = {
      anchor:  makeStubAnchor(),
      store,
      source:  makeInMemoryEventSource(events),
      network: "base-sepolia",
      now:     () => NOW,
      logger:  makeConsoleLogger(),
      newId:   () => "anchor_run_1",
    };
    const res = await request(buildApp(deps)).post("/v1/admin/anchor/run");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.recordId).toBe("anchor_run_1");
    expect(res.body.sequence).toBe(1);
    expect(res.body.txHash).toBe(TX);
    expect(res.body.leafCount).toBe(3);
    expect(res.body.root).toMatch(/^0x[0-9a-f]{64}$/);

    expect(store.records).toHaveLength(1);
    expect(store.marked[0].eventIds).toEqual(["e1", "e2", "e3"]);
    expect(store.marked[0].anchorRecordId).toBe("anchor_run_1");
  });
});

describe("POST /v1/admin/anchor/run — chain failure", () => {
  it("returns 500 with error code on CHAIN_TX_FAILED", async () => {
    const deps: RunAnchorDeps = {
      anchor: makeStubAnchor({
        postAnchor: vi.fn(async () => { throw new Error("execution reverted"); }),
      }),
      store:   makeInMemoryAnchorStore(),
      source:  makeInMemoryEventSource([evt("e1", "aa")]),
      network: "base-sepolia",
      now:     () => NOW,
      logger:  makeConsoleLogger(),
    };
    const res = await request(buildApp(deps)).post("/v1/admin/anchor/run");
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("CHAIN_TX_FAILED");
    expect(res.body.error.detail).toContain("execution reverted");
  });
});

describe("POST /v1/admin/anchor/run — idempotency under ALREADY_ANCHORED", () => {
  it("two calls against the same registry state — second call sees ALREADY_ANCHORED, returns existing record", async () => {
    // First call: normal happy path; record gets written.
    const events = [evt("e1", "aa")];
    const store  = makeInMemoryAnchorStore();

    let postCount = 0;
    const anchor: AnchorProvider = {
      buildTree: () => ({ root: H("aa"), leaves: [], proofFor: () => null }),
      postAnchor: async (root: Hex32) => {
        postCount += 1;
        if (postCount === 1) {
          return {
            root,
            txHash: TX,
            blockNumber: 100n,
            timestamp: 1_700_000_001n,
          } as AnchorReceipt;
        }
        // Second call: chain reports already anchored
        throw new Error("revert: root already anchored");
      },
      readAnchor:  async () => null,
      verifyProof: () => true,
    };

    // First call
    const firstSource = makeInMemoryEventSource([...events]);
    const depsA: RunAnchorDeps = {
      anchor, store, source: firstSource, network: "base-sepolia",
      now: () => NOW, logger: makeConsoleLogger(),
      newId: () => "anchor_first",
    };
    const r1 = await request(buildApp(depsA)).post("/v1/admin/anchor/run");
    expect(r1.status).toBe(200);
    expect(r1.body.recordId).toBe("anchor_first");

    // Second call — same plan, chain reports already anchored.
    // findAnchorRecordByRoot resolves the existing record by Merkle root.
    const secondSource = makeInMemoryEventSource([...events]);
    const depsB: RunAnchorDeps = {
      anchor, store, source: secondSource, network: "base-sepolia",
      now: () => NOW, logger: makeConsoleLogger(),
      newId: () => "anchor_should_not_be_used",
    };
    const r2 = await request(buildApp(depsB)).post("/v1/admin/anchor/run");
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);
    // Returns the EXISTING record id — not the second-call newId.
    expect(r2.body.recordId).toBe("anchor_first");
    // No second AnchorRecord written.
    expect(store.records).toHaveLength(1);
  });
});

describe("POST /v1/admin/anchor/run — response shape", () => {
  it("matches the documented success-with-events contract", async () => {
    const deps: RunAnchorDeps = {
      anchor:  makeStubAnchor(),
      store:   makeInMemoryAnchorStore(),
      source:  makeInMemoryEventSource([evt("e1", "aa")]),
      network: "base-sepolia",
      now:     () => NOW,
      logger:  makeConsoleLogger(),
      newId:   () => "anchor_shape_1",
    };
    const res = await request(buildApp(deps)).post("/v1/admin/anchor/run");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["leafCount", "ok", "recordId", "root", "sequence", "txHash"].sort(),
    );
  });

  it("matches the documented empty contract", async () => {
    const deps: RunAnchorDeps = {
      anchor:  makeStubAnchor(),
      store:   makeInMemoryAnchorStore(),
      source:  makeInMemoryEventSource([]),
      network: "base-sepolia",
      now:     () => NOW,
      logger:  makeConsoleLogger(),
    };
    const res = await request(buildApp(deps)).post("/v1/admin/anchor/run");
    expect(Object.keys(res.body).sort()).toEqual(
      ["leafCount", "message", "ok"].sort(),
    );
  });
});
