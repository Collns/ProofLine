/**
 * @file service-factory.ts
 * @module apps/functions/src/anchoring
 *
 * Wires the anchor scheduler/manual endpoint with either the real
 * implementation (viem against Base Sepolia + Firestore) or stubs
 * suitable for local dev / tests.
 *
 * Env mapping (matches .env.example, NOT the spec field names verbatim):
 *
 *   BASE_SEPOLIA_RPC          → AnchorProvider RPC URL
 *   DEPLOYER_PRIVATE_KEY      → AnchorProvider signer key
 *   ANCHOR_CONTRACT_ADDRESS   → AnchorProvider contract address
 *   FIREBASE_PROJECT_ID       → Firestore client (already set by Functions)
 *
 * Behavior:
 *   - In production (NODE_ENV=production), missing env throws explicitly.
 *   - Outside production, missing env transparently falls back to stubs
 *     so local dev / tests don't need a real wallet.
 */

import type { AnchorProvider, Hex32, AnchorReceipt, MerkleProof } from "@proofline/anchoring";
// PFL-107: static import. The prior dynamic `createRequire(...dist/providers/
// viem-base-sepolia.js)` failed at runtime — esbuild bundles functions into
// a single file so that path doesn't exist in the deployed bundle. The
// provider is now re-exported from the package root.
import { makeViemBaseSepoliaAnchorProvider } from "@proofline/anchoring";

import type { RegistryEvent } from "./batch.js";
import type {
  AnchorRecord,
  AnchorStore,
  AnchorLogger,
  AnchorNetwork,
} from "./post-anchor.js";
import type { EventSource, RunAnchorDeps } from "./run-batch.js";

// ─── Console-backed logger (until @proofline/observability is wired) ──────────

export function makeConsoleLogger(): AnchorLogger {
  return {
    captureError(err, context) {
      console.error("[anchor]", err.message, context ?? {});
    },
    log(level, event, data) {
      const line = JSON.stringify({ level, event, ...(data ?? {}) });
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    },
  };
}

// ─── Firestore-backed AnchorStore ─────────────────────────────────────────────

/**
 * Drains the `anchor_queue/` collection (written by signing.helpers.ts:235).
 * Each entry there represents one envelope to be anchored. We treat the
 * document id as the RegistryEvent.id, the envelope's payloadHash as the
 * leaf hash, and "envelope" as the kind.
 *
 * On markEventsAnchored we delete the queue entries (a future migration
 * adds anchored:true on the source documents — see post-anchor.ts header).
 */
export function makeFirestoreEventSource(): EventSource {
  return {
    async collectUnanchoredEvents(): Promise<RegistryEvent[]> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirestore } = require("firebase-admin/firestore");
      const db   = getFirestore();
      const snap = await db.collection("anchor_queue").orderBy("queuedAt").get();

      const events: RegistryEvent[] = [];
      for (const d of snap.docs) {
        const data = d.data() as { envelopeId: string; payloadHash: string; queuedAt: number };
        const hash = normalizeHex32(data.payloadHash);
        if (!hash) {
          // Skip malformed entries; surface via console so we can dig later.
          console.warn("[anchor] skipping queue entry with non-hex32 payloadHash", {
            queueId: d.id,
            envelopeId: data.envelopeId,
          });
          continue;
        }
        events.push({
          kind:      "envelope",
          id:        d.id,
          hash,
          createdAt: data.queuedAt,
        });
      }
      return events;
    },
  };
}

export function makeFirestoreAnchorStore(): AnchorStore {
  return {
    async getLatestSequence(): Promise<number> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      const snap = await db
        .collection("anchors")
        .orderBy("sequence", "desc")
        .limit(1)
        .get();
      if (snap.empty) return 0;
      return (snap.docs[0].data() as { sequence: number }).sequence;
    },

    async findAnchorRecordByRoot(root: Hex32): Promise<AnchorRecord | null> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      const snap = await db
        .collection("anchors")
        .where("root", "==", root)
        .limit(1)
        .get();
      if (snap.empty) return null;
      return snap.docs[0].data() as AnchorRecord;
    },

    async writeAnchorRecord(rec: AnchorRecord): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      await db.collection("anchors").doc(rec.id).set(rec);
    },

    async markEventsAnchored(eventIds: string[], anchorRecordId: string): Promise<void> {
      if (eventIds.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();

      // PFL-106: the previous impl only DELETED the anchor_queue entries —
      // the on-chain anchor coordinates never reached the signed_messages
      // doc, so the verify page always read a null anchor → "Anchor pending"
      // forever. Read the just-written AnchorRecord and stamp its root /
      // txHash / blockNumber / blockTimestamp back onto each anchored
      // envelope, THEN delete the queue entry.
      const anchorSnap = await db.collection("anchors").doc(anchorRecordId).get();
      const anchorData = anchorSnap.exists
        ? (anchorSnap.data() as {
            root?: string;
            txHash?: string;
            blockNumber?: number;
            blockTimestamp?: number;
          })
        : null;

      // Firestore batch limit is 500 ops; chunk just in case (we now do up
      // to 2 ops per event: signed_messages.set + anchor_queue.delete).
      const CHUNK = 200;
      for (let i = 0; i < eventIds.length; i += CHUNK) {
        const chunk = eventIds.slice(i, i + CHUNK);
        // Resolve each queue entry's envelopeId before we delete it.
        const queueDocs = await Promise.all(
          chunk.map((id: string) => db.collection("anchor_queue").doc(id).get()),
        );
        const batch = db.batch();
        for (let j = 0; j < chunk.length; j++) {
          const id = chunk[j];
          const qd = queueDocs[j];
          if (anchorData?.root && qd.exists) {
            const envelopeId = (qd.data() as { envelopeId?: string }).envelopeId;
            if (envelopeId) {
              batch.set(
                db.collection("signed_messages").doc(envelopeId),
                {
                  anchorRoot:           anchorData.root,
                  anchorTxHash:         anchorData.txHash ?? "",
                  anchorBlockNumber:    anchorData.blockNumber ?? 0,
                  anchorBlockTimestamp: anchorData.blockTimestamp ?? 0,
                },
                { merge: true },
              );
            }
          }
          batch.delete(db.collection("anchor_queue").doc(id));
        }
        await batch.commit();
      }
    },
  };
}

// ─── Stubs (in-memory, for local dev when env vars are absent) ────────────────

export function makeStubAnchorProvider(): AnchorProvider {
  let blockN = 1n;
  return {
    buildTree(leaves) {
      return {
        root:   leaves[0] ?? (`0x${"00".repeat(32)}` as Hex32),
        leaves,
        proofFor: (_l: Hex32): MerkleProof | null => null,
      };
    },
    async postAnchor(root): Promise<AnchorReceipt> {
      const block = blockN++;
      return {
        root,
        txHash:      `0x${"de".repeat(32)}` as Hex32,
        blockNumber: block,
        timestamp:   BigInt(Math.floor(Date.now() / 1000)),
      };
    },
    async readAnchor(_root) { return null; },
    verifyProof()           { return true;  },
  };
}

export function makeInMemoryEventSource(events: RegistryEvent[]): EventSource {
  return {
    async collectUnanchoredEvents() {
      // Return + clear (one-shot) — tests can pre-populate fresh between cases.
      const out = [...events];
      events.length = 0;
      return out;
    },
  };
}

export function makeInMemoryAnchorStore(): AnchorStore & {
  records: AnchorRecord[];
  marked:  Array<{ eventIds: string[]; anchorRecordId: string }>;
} {
  const records: AnchorRecord[] = [];
  const marked:  Array<{ eventIds: string[]; anchorRecordId: string }> = [];
  return {
    records,
    marked,
    async getLatestSequence() {
      if (records.length === 0) return 0;
      return Math.max(...records.map((r) => r.sequence));
    },
    async findAnchorRecordByRoot(root) {
      return records.find((r) => r.root === root) ?? null;
    },
    async writeAnchorRecord(rec) { records.push(rec); },
    async markEventsAnchored(eventIds, anchorRecordId) {
      marked.push({ eventIds, anchorRecordId });
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeHex32(s: string): Hex32 | null {
  if (typeof s !== "string") return null;
  const withPrefix = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  return withPrefix as Hex32;
}

// ─── Public factory ───────────────────────────────────────────────────────────

export interface AnchorEnvConfig {
  rpcUrl?:           string;
  deployerKey?:      string;
  contractAddress?:  string;
  nodeEnv?:          string;
}

export function readAnchorEnv(env: NodeJS.ProcessEnv = process.env): AnchorEnvConfig {
  return {
    rpcUrl:          env.BASE_SEPOLIA_RPC,
    deployerKey:     env.DEPLOYER_PRIVATE_KEY,
    contractAddress: env.ANCHOR_CONTRACT_ADDRESS,
    nodeEnv:         env.NODE_ENV,
  };
}

/**
 * Returns fully-wired RunAnchorDeps for the scheduler / manual endpoint.
 *
 * If any required env var is missing AND NODE_ENV !== 'production',
 * falls back to the in-memory stub provider + Firestore store. This
 * lets local dev exercise the scheduler without burning Sepolia gas.
 *
 * In production, missing env throws.
 */
export function makeAnchorRunDeps(
  env: AnchorEnvConfig = readAnchorEnv(),
  overrides: Partial<RunAnchorDeps> = {},
): RunAnchorDeps {
  const isProd = env.nodeEnv === "production";

  let anchor: AnchorProvider;
  if (overrides.anchor) {
    anchor = overrides.anchor;
  } else if (env.rpcUrl && env.deployerKey && env.contractAddress) {
    anchor = makeViemBaseSepoliaAnchorProvider({
      rpcUrl:             env.rpcUrl,
      deployerPrivateKey: env.deployerKey as `0x${string}`,
      contractAddress:    env.contractAddress as `0x${string}`,
    });
  } else if (isProd) {
    throw new Error(
      "Anchor env missing in production: require BASE_SEPOLIA_RPC, " +
      "DEPLOYER_PRIVATE_KEY, ANCHOR_CONTRACT_ADDRESS",
    );
  } else {
    console.warn("[anchor] env incomplete — falling back to stub AnchorProvider");
    anchor = makeStubAnchorProvider();
  }

  return {
    anchor,
    store:   overrides.store   ?? makeFirestoreAnchorStore(),
    source:  overrides.source  ?? makeFirestoreEventSource(),
    network: overrides.network ?? "base-sepolia",
    now:     overrides.now     ?? (() => Date.now()),
    logger:  overrides.logger  ?? makeConsoleLogger(),
    newId:   overrides.newId,
  };
}
