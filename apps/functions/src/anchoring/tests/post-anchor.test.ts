import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AnchorProvider, Hex32, MerkleTree, MerkleProof, AnchorReceipt } from "@proofline/anchoring";

import { postAnchorBatch } from "../post-anchor.js";
import type {
  AnchorStore,
  AnchorLogger,
  AnchorRecord,
  PostAnchorDeps,
} from "../post-anchor.js";
import type { BatchPlan } from "../batch.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOT: Hex32       = `0x${"ab".repeat(32)}` as Hex32;
const TX_HASH           = `0x${"cd".repeat(32)}` as Hex32;
const NOW               = 1_700_000_000_000;

function makePlan(over: Partial<BatchPlan> = {}): BatchPlan {
  const stubTree: MerkleTree = {
    root: ROOT,
    leaves: [ROOT],
    proofFor(_l: Hex32): MerkleProof | null { return null; },
  };
  return {
    root:      ROOT,
    leafCount: 1,
    leaves:    [ROOT],
    tree:      stubTree,
    sequence:  1,
    plannedAt: NOW,
    eventIds:  ["e1"],
    ...over,
  };
}

function makeAnchorProvider(over: Partial<AnchorProvider> = {}): AnchorProvider {
  return {
    buildTree: vi.fn(() => ({
      root: ROOT,
      leaves: [],
      proofFor: () => null,
    })),
    postAnchor: vi.fn(async (_root: Hex32): Promise<AnchorReceipt> => ({
      root:        ROOT,
      txHash:      TX_HASH,
      blockNumber: 12345678n,
      timestamp:   1_700_000_001n,
    })),
    readAnchor:  vi.fn(async () => null),
    verifyProof: vi.fn(() => true),
    ...over,
  };
}

function makeStore(over: Partial<AnchorStore> = {}): AnchorStore {
  const writes: AnchorRecord[] = [];
  return {
    getLatestSequence:     vi.fn(async () => 0),
    findAnchorRecordByRoot:vi.fn(async (_r: Hex32) => null),
    writeAnchorRecord:     vi.fn(async (rec: AnchorRecord) => { writes.push(rec); }),
    markEventsAnchored:    vi.fn(async (_ids: string[], _rid: string) => {}),
    ...over,
  };
}

function makeLogger(): AnchorLogger {
  return {
    captureError: vi.fn(),
    log:          vi.fn(),
  };
}

function makeDeps(over: Partial<PostAnchorDeps> = {}): PostAnchorDeps {
  return {
    anchor:  makeAnchorProvider(),
    store:   makeStore(),
    now:     () => NOW,
    logger:  makeLogger(),
    network: "base-sepolia",
    newId:   () => "anchor_test_1",
    ...over,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("postAnchorBatch — happy path", () => {
  it("posts root, builds an AnchorRecord, writes it, marks events anchored", async () => {
    const deps = makeDeps();
    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("anchor_test_1");
    expect(result.value.root).toBe(ROOT);
    expect(result.value.txHash).toBe(TX_HASH);
    expect(result.value.blockNumber).toBe(12345678);
    expect(result.value.blockTimestamp).toBe(1_700_000_001);
    expect(result.value.network).toBe("base-sepolia");
    expect(result.value.postedAt).toBe(NOW);

    expect(deps.anchor.postAnchor).toHaveBeenCalledWith(ROOT);
    expect(deps.store.writeAnchorRecord).toHaveBeenCalledOnce();
    expect(deps.store.markEventsAnchored).toHaveBeenCalledWith(["e1"], "anchor_test_1");
  });

  it("network=base-mainnet is reflected in record", async () => {
    const deps = makeDeps({ network: "base-mainnet" });
    const result = await postAnchorBatch(makePlan(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.network).toBe("base-mainnet");
  });
});

describe("postAnchorBatch — chain failure modes", () => {
  it("CHAIN_TX_FAILED: returns error, does NOT write record, does NOT mark events", async () => {
    const anchor = makeAnchorProvider({
      postAnchor: vi.fn(async () => { throw new Error("execution reverted: bad nonce"); }),
    });
    const deps = makeDeps({ anchor });
    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CHAIN_TX_FAILED");
    expect(deps.store.writeAnchorRecord).not.toHaveBeenCalled();
    expect(deps.store.markEventsAnchored).not.toHaveBeenCalled();
    expect(deps.logger.captureError).toHaveBeenCalled();
  });

  it("CHAIN_TIMEOUT: timeout-shaped error returns CHAIN_TIMEOUT", async () => {
    const anchor = makeAnchorProvider({
      postAnchor: vi.fn(async () => {
        const e = new Error("Request timed out after 30000ms");
        e.name = "TimeoutError";
        throw e;
      }),
    });
    const deps = makeDeps({ anchor });
    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CHAIN_TIMEOUT");
    expect(deps.store.writeAnchorRecord).not.toHaveBeenCalled();
    expect(deps.logger.captureError).toHaveBeenCalled();
  });
});

describe("postAnchorBatch — ALREADY_ANCHORED idempotency", () => {
  let existing: AnchorRecord;

  beforeEach(() => {
    existing = {
      id:             "anchor_existing",
      sequence:       1,
      root:           ROOT,
      leafCount:      1,
      leaves:         [ROOT],
      txHash:         TX_HASH,
      blockNumber:    12345678,
      blockTimestamp: 1_700_000_001,
      postedAt:       NOW - 1000,
      network:        "base-sepolia",
    };
  });

  it("returns the existing record (idempotent retry) and marks events anchored", async () => {
    const anchor = makeAnchorProvider({
      postAnchor: vi.fn(async () => { throw new Error("revert: root already anchored"); }),
    });
    const store = makeStore({
      findAnchorRecordByRoot: vi.fn(async () => existing),
    });
    const deps = makeDeps({ anchor, store });

    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("anchor_existing");
    expect(deps.store.writeAnchorRecord).not.toHaveBeenCalled(); // don't re-write
    expect(deps.store.markEventsAnchored).toHaveBeenCalledWith(["e1"], "anchor_existing");
  });

  it("ALREADY_ANCHORED but no local record returns ALREADY_ANCHORED error", async () => {
    const anchor = makeAnchorProvider({
      postAnchor: vi.fn(async () => { throw new Error("root already anchored"); }),
    });
    const deps = makeDeps({ anchor }); // store.findAnchorRecordByRoot defaults to null

    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ALREADY_ANCHORED");
  });
});

describe("postAnchorBatch — store failure", () => {
  it("STORE_WRITE_FAILED on writeAnchorRecord", async () => {
    const store = makeStore({
      writeAnchorRecord: vi.fn(async () => { throw new Error("Firestore unavailable"); }),
    });
    const deps = makeDeps({ store });
    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_WRITE_FAILED");
    expect(deps.logger.captureError).toHaveBeenCalled();
  });

  it("STORE_WRITE_FAILED on markEventsAnchored (after record was written)", async () => {
    const store = makeStore({
      markEventsAnchored: vi.fn(async () => { throw new Error("Batch write quota exceeded"); }),
    });
    const deps = makeDeps({ store });
    const result = await postAnchorBatch(makePlan(), deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_WRITE_FAILED");
    expect(deps.store.writeAnchorRecord).toHaveBeenCalledOnce();
  });
});

describe("postAnchorBatch — observability", () => {
  it("logger.captureError is called on chain failures (with component tag)", async () => {
    const anchor = makeAnchorProvider({
      postAnchor: vi.fn(async () => { throw new Error("network down"); }),
    });
    const deps = makeDeps({ anchor });
    await postAnchorBatch(makePlan(), deps);

    expect(deps.logger.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ component: "post-anchor" }),
      }),
    );
  });
});
