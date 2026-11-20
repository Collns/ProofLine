/**
 * PFL-146 — bilateral document flow end to end, over a Firestore-backed store
 * and the real HTTP handlers:
 *
 *   draft → sign-as-drafter → PENDING_COUNTERPARTY
 *   → counterparty opens web-sign: GET countersign-context (challenge)
 *   → POST sign-as-counterparty (verified assertion) → BILATERAL_SIGNED
 *   → anchor_queue row (collection: bilateral_documents)
 *   → anchor batch stamps the on-chain coordinates onto bilateral_documents.
 *
 * No identity is taken from client input: the counterparty company comes from
 * the signed link token and the user from the verified credential.
 *
 * (That a BILATERAL_SIGNED document then renders BOTH signers on the verify
 * page is covered by verify/tests/verify.handler.test.ts, which uses real
 * credential signatures rather than a stubbed assertion.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore shared by every handler + store in this test ─────────

const store: Record<string, Record<string, Record<string, unknown>>> = {};
function col(name: string) { store[name] = store[name] ?? {}; return store[name]!; }
function docRef(c: string, id: string) {
  return {
    id,
    async get() { const d = col(c)[id]; return { exists: Boolean(d), id, data: () => d, ref: docRef(c, id) }; },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      col(c)[id] = opts?.merge ? { ...(col(c)[id] ?? {}), ...data } : { ...data };
    },
    async delete() { delete col(c)[id]; },
  };
}
function orderedQuery(c: string) {
  return {
    orderBy: () => orderedQuery(c),
    limit: () => orderedQuery(c),
    where: () => orderedQuery(c),
    async get() {
      const docs = Object.entries(col(c)).map(([id, d]) => ({ id, data: () => d, ref: docRef(c, id) }));
      return { empty: docs.length === 0, docs };
    },
  };
}
const db = {
  batch() {
    const ops: Array<() => void> = [];
    return {
      set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
        ops.push(() => { void ref.set(data, opts); }),
      delete: (ref: ReturnType<typeof docRef>) => ops.push(() => { void ref.delete(); }),
      async commit() { for (const op of ops) op(); },
    };
  },
  collection: (c: string) => ({
    doc: (id: string) => docRef(c, id),
    orderBy: () => orderedQuery(c),
    where: () => orderedQuery(c),
    limit: () => orderedQuery(c),
    async add(data: Record<string, unknown>) {
      const id = `auto_${Object.keys(col(c)).length + 1}`;
      col(c)[id] = { ...data };
      return { id };
    },
  }),
};

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => db }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => [{}]), getApp: vi.fn() }));
vi.mock("@proofline/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@proofline/webauthn")>("@proofline/webauthn");
  return { ...actual, finishAssertion: vi.fn(async () => ({ ok: true, signCount: 1, credentialId: "c" })) };
});

import { makeBilateralService } from "@proofline/bilateral";
import { makeBilateralRouter } from "../router.js";
import { makeFirestoreBilateralStore } from "../firestore-store.js";
import { makeFirestoreAnchorStore } from "../../../anchoring/service-factory.js";
import { buildCounterpartyJwsLink } from "../jws.helpers.js";

const DRAFTER = "company-a";
const CP = "company-b";
const CP_USER = "user-b";
const CP_CRED = "cred-b";
const DRAFTER_USER = "user-a";
const DOC_ID = "doc_e2e_0001";

function buildApp() {
  const app = express();
  app.use(express.json());
  const service = makeBilateralService({
    store: makeFirestoreBilateralStore(),
    now: () => Math.floor(Date.now() / 1000),
  });
  // Drafter routes expect a company user (web-admin). The counterparty routes
  // ignore req.user entirely — identity comes from the token + credential.
  app.use((req, _res, next) => {
    (req as express.Request & { user: unknown }).user = { userId: DRAFTER_USER, companyId: DRAFTER };
    next();
  });
  app.use(
    "/v1/bilateral",
    makeBilateralRouter({
      bilateralService: service,
      email: { sendBilateralRequest: vi.fn(async () => {}) } as never,
      counterpartyPortalBaseUrl: "https://portal.test",
    }),
  );
  return app;
}

function tokenFor(docId: string) {
  return buildCounterpartyJwsLink({
    baseUrl: "https://portal.test", docId, drafterCompanyId: DRAFTER,
    counterpartyCompanyId: CP, expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }).then((link) => decodeURIComponent(new URL(link).searchParams.get("t")!));
}

void DOC_ID; // the drafter route assigns its own doc id

const assertion = { id: CP_CRED, response: { clientDataJSON: "cd", authenticatorData: "ad", signature: "cp-sig" } };

/** Simulate the anchor batch draining the queue for a stub-anchored root. */
async function runAnchorWriteBack(): Promise<void> {
  const anchorStore = makeFirestoreAnchorStore();
  const anchorId = "anchor-1";
  await anchorStore.writeAnchorRecord({
    id: anchorId, sequence: 1,
    root: "0xabc123", txHash: "0xtx", blockNumber: 42, blockTimestamp: 1_700_000_500,
  } as never);
  const queueIds = Object.keys(col("anchor_queue"));
  await anchorStore.markEventsAnchored(queueIds, anchorId);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  col("webauthn_credentials")[CP_CRED] = { userId: CP_USER, companyId: CP, publicKey: "cose-b" };
  col("users")[CP_USER] = { companyId: CP, status: "active" };
});

describe("bilateral end-to-end (PFL-146)", () => {
  it("draft → drafter → counterparty (web-sign) → BILATERAL_SIGNED → anchored", async () => {
    const app = buildApp();

    // 1. Drafter drafts + signs → PENDING_COUNTERPARTY. The route assigns the
    //    doc id server-side; we thread it through the rest of the flow.
    const draftRes = await request(app).post("/v1/bilateral/draft").send({
      docType: "banking_change",
      counterpartyCompanyId: CP,
      content: { account: "****1234" }, expiresInSeconds: 7 * 24 * 3600,
    }).expect(201);
    const docId = draftRes.body.docId as string;
    expect(docId).toBeTruthy();

    await request(app).post("/v1/bilateral/sign-as-drafter").send({
      docId, sig: "drafter-sig", counterpartyEmail: "cp@company-b.com", drafterName: "Dana Drafter",
    }).expect(200);

    // 2. Counterparty opens web-sign: fetch the context (server-issued challenge).
    const token = await tokenFor(docId);
    const ctxRes = await request(app).get(`/v1/bilateral/${docId}/countersign-context`).query({ token });
    expect(ctxRes.body.ok).toBe(true);
    const challenge = ctxRes.body.challenge as string;

    // 3. Counterparty signs with a verified assertion → BILATERAL_SIGNED.
    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge, assertion })
      .expect(200);

    const storedDoc = col("bilateral_documents")[docId] as { events: Array<{ kind: string; actorId: string }> };
    const signedKinds = storedDoc.events.filter((e) => e.kind.endsWith("_SIGNED")).map((e) => e.kind);
    expect(signedKinds).toContain("DRAFTER_SIGNED");
    expect(signedKinds).toContain("COUNTERPARTY_SIGNED");
    // The counterparty's user id was derived from the credential, not the body.
    const cpEvent = storedDoc.events.find((e) => e.kind === "COUNTERPARTY_SIGNED");
    expect(cpEvent?.actorId).toBe(CP_USER);

    // 4. The completed doc was queued for anchoring against bilateral_documents.
    const queue = Object.values(col("anchor_queue"));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ envelopeId: docId, collection: "bilateral_documents" });

    // 5. The anchor batch stamps the coordinates onto bilateral_documents
    //    (not signed_messages), so the verify page can show a confirmed anchor.
    await runAnchorWriteBack();
    const anchored = col("bilateral_documents")[docId] as { anchorRoot?: string; anchorBlockNumber?: number };
    expect(anchored.anchorRoot).toBe("0xabc123");
    expect(anchored.anchorBlockNumber).toBe(42);
    expect(col("anchor_queue")).toEqual({}); // queue drained
  });
});
