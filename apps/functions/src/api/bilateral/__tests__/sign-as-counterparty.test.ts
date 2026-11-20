/**
 * PFL-182 — the counterparty ceremony runs on web-sign and the server
 * verifies the WebAuthn assertion before recording the signature.
 *
 * Matrix: valid sign; unverified assertion rejected; tampered payload
 * (challenge mismatch); wrong / expired link token; foreign-company
 * credential rejected; replay (second finalize refused).
 *
 * In-memory Firestore for bilateral_challenges / webauthn_credentials /
 * users; WebAuthn verification is stubbed at finishAssertion (toggled per
 * test). The document itself lives in the service's in-memory store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore (collection/doc subset the handlers use) ─────────────

const store: Record<string, Record<string, Record<string, unknown>>> = {};
function col(name: string) {
  store[name] = store[name] ?? {};
  return store[name]!;
}
function docRef(c: string, id: string) {
  return {
    id,
    async get() { const d = col(c)[id]; return { exists: Boolean(d), id, data: () => d }; },
    async set(data: Record<string, unknown>) { col(c)[id] = { ...data }; },
    async delete() { delete col(c)[id]; },
  };
}
const db = { collection: (c: string) => ({ doc: (id: string) => docRef(c, id) }) };

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => db }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => [{}]), getApp: vi.fn() }));

// finishAssertion is stubbed; `assertionOk` lets a test force a failure.
let assertionOk = true;
vi.mock("@proofline/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@proofline/webauthn")>("@proofline/webauthn");
  return {
    ...actual,
    finishAssertion: vi.fn(async () =>
      assertionOk
        ? { ok: true, signCount: 1, credentialId: "c" }
        : { ok: false, reason: "SIGNATURE_INVALID" },
    ),
  };
});

import { makeBilateralService, makeMemoryStore } from "@proofline/bilateral";
import type { BilateralService } from "@proofline/bilateral";
import { makeBilateralRouter } from "../router.js";
import { buildCounterpartyJwsLink } from "../jws.helpers.js";

const DRAFTER = "co-drafter";
const CP = "co-counterparty";
const CP_USER = "u-cp";
const CP_CRED = "cred-cp";

let service: BilateralService;

function buildApp() {
  const app = express();
  app.use(express.json());
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

async function pendingDoc(docId = "doc_cp_0001"): Promise<string> {
  await service.draftDocument({
    docId,
    docType: "banking_change",
    drafterCompanyId: DRAFTER,
    counterpartyCompanyId: CP,
    content: { account: "****1234" },
    expiresInSeconds: 7 * 24 * 3600,
    nonce: "n".repeat(32),
  } as never);
  await service.signAsDrafter(docId, { userId: "u-d", companyId: DRAFTER }, "sig-d");
  return docId;
}

function tokenFor(docId: string, cp = CP, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  return buildCounterpartyJwsLink({
    baseUrl: "https://portal.test", docId, drafterCompanyId: DRAFTER,
    counterpartyCompanyId: cp, expiresAt,
  }).then((link) => decodeURIComponent(new URL(link).searchParams.get("t")!));
}

const assertion = {
  id: CP_CRED,
  response: { clientDataJSON: "cd", authenticatorData: "ad", signature: "cp-sig" },
};

async function getContext(app: express.Express, docId: string, token: string) {
  const res = await request(app).get(`/v1/bilateral/${docId}/countersign-context`).query({ token });
  return res.body as { ok: boolean; challenge?: string; code?: string };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  assertionOk = true;
  service = makeBilateralService({ store: makeMemoryStore(), now: () => Math.floor(Date.now() / 1000) });
  col("webauthn_credentials")[CP_CRED] = { userId: CP_USER, companyId: CP, publicKey: "cose-cp" };
  col("users")[CP_USER] = { companyId: CP, status: "active" };
});

describe("POST /v1/bilateral/sign-as-counterparty (PFL-182)", () => {
  it("records a verified counterparty signature → BILATERAL_SIGNED", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    const ctx = await getContext(app, docId, token);
    expect(ctx.ok).toBe(true);

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(200);

    const status = await service.getStatus(docId);
    expect(status.ok && status.value).toBe("BILATERAL_SIGNED");

    // The signature landed on the event log with its assertion artifacts.
    const doc = await service.getDocument(docId);
    const cpEvent = doc.ok && doc.value.events.find((e) => e.kind === "COUNTERPARTY_SIGNED");
    expect(cpEvent && cpEvent.actorId).toBe(CP_USER);
    expect(cpEvent && cpEvent.credentialId).toBe(CP_CRED);
    expect(cpEvent && cpEvent.clientDataJSON).toBe("cd");
  });

  it("rejects an unverified assertion (401) and does not sign", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    const ctx = await getContext(app, docId, token);
    assertionOk = false;

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(401);

    const status = await service.getStatus(docId);
    expect(status.ok && status.value).toBe("PENDING_COUNTERPARTY");
  });

  it("rejects a tampered payload — challenge does not match the issued one (400)", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    await getContext(app, docId, token);

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: "not-the-issued-challenge", assertion })
      .expect(400);
  });

  it("rejects a missing / invalid token (401)", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    const ctx = await getContext(app, docId, token);

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(401);

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", "garbage.token.here")
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(401);
  });

  it("rejects an expired token (401)", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const expired = await tokenFor(docId, CP, Math.floor(Date.now() / 1000) - 10);

    // Context refuses the expired link too.
    const ctx = await getContext(app, docId, expired);
    expect(ctx.ok).toBe(false);
    expect(ctx.code).toBe("BILATERAL_LINK_EXPIRED");

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", expired)
      .send({ docId, challenge: "x", assertion })
      .expect(401);
  });

  it("rejects a credential from another company (403)", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    const ctx = await getContext(app, docId, token);
    // The passkey belongs to a different company than the token's `cp`.
    col("webauthn_credentials")[CP_CRED] = { userId: "u-x", companyId: "co-other", publicKey: "cose-x" };

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(403);

    const status = await service.getStatus(docId);
    expect(status.ok && status.value).toBe("PENDING_COUNTERPARTY");
  });

  it("refuses a replayed finalize — the challenge is single-use", async () => {
    const app = buildApp();
    const docId = await pendingDoc();
    const token = await tokenFor(docId);
    const ctx = await getContext(app, docId, token);

    await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: ctx.challenge, assertion })
      .expect(200);

    // Same challenge again — it was deleted, so there is no active challenge.
    const replay = await request(app)
      .post("/v1/bilateral/sign-as-counterparty")
      .set("X-ProofLine-Bilateral-Token", token)
      .send({ docId, challenge: ctx.challenge, assertion });
    expect(replay.status).not.toBe(200);

    // Even if a fresh challenge is minted, the document can't be signed twice.
    const ctx2 = await getContext(app, docId, token);
    // ctx2 refuses because the doc is already BILATERAL_SIGNED.
    expect(ctx2.ok).toBe(false);
    expect(ctx2.code).toBe("ALREADY_SIGNED");
  });
});
