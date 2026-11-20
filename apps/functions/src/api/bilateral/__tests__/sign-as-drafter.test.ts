/**
 * PFL-146 — the drafter signs with a verified WebAuthn assertion bound to the
 * canonical payload; an unverified assertion or a passkey that isn't the
 * signed-in drafter's is rejected, and nothing is stored unverified.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};
function col(name: string) { store[name] = store[name] ?? {}; return store[name]!; }
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

let assertionOk = true;
vi.mock("@proofline/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@proofline/webauthn")>("@proofline/webauthn");
  return {
    ...actual,
    finishAssertion: vi.fn(async () =>
      assertionOk ? { ok: true, signCount: 1, credentialId: "c" } : { ok: false, reason: "SIGNATURE_INVALID" },
    ),
  };
});

import { makeBilateralService, makeMemoryStore } from "@proofline/bilateral";
import type { BilateralService } from "@proofline/bilateral";
import { makeBilateralRouter } from "../router.js";

const DRAFTER = "co-drafter";
const DRAFTER_USER = "u-drafter";
const DRAFTER_CRED = "cred-drafter";
const CP = "co-counterparty";

let service: BilateralService;

function buildApp(user: { userId: string; companyId: string } = { userId: DRAFTER_USER, companyId: DRAFTER }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { user: unknown }).user = user; next(); });
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

async function draft(): Promise<string> {
  const docId = "doc_draft_0001";
  await service.draftDocument({
    docId, docType: "banking_change", drafterCompanyId: DRAFTER, counterpartyCompanyId: CP,
    content: { account: "****1" }, expiresInSeconds: 7 * 24 * 3600, nonce: "n".repeat(32),
  } as never);
  return docId;
}

const assertion = { id: DRAFTER_CRED, response: { clientDataJSON: "cd", authenticatorData: "ad", signature: "d-sig" } };
const body = (docId: string) => ({ docId, assertion, counterpartyEmail: "cp@co-counterparty.com", drafterName: "Dana" });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  assertionOk = true;
  service = makeBilateralService({ store: makeMemoryStore(), now: () => Math.floor(Date.now() / 1000) });
  col("webauthn_credentials")[DRAFTER_CRED] = { userId: DRAFTER_USER, companyId: DRAFTER, publicKey: "cose-d" };
});

describe("POST /v1/bilateral/sign-as-drafter (PFL-146 drafter verification)", () => {
  it("records a verified drafter signature → PENDING_COUNTERPARTY with assertion artifacts", async () => {
    const docId = await draft();
    await request(buildApp()).post("/v1/bilateral/sign-as-drafter").send(body(docId)).expect(200);

    const status = await service.getStatus(docId);
    expect(status.ok && status.value).toBe("PENDING_COUNTERPARTY");
    const doc = await service.getDocument(docId);
    const ev = doc.ok && doc.value.events.find((e) => e.kind === "DRAFTER_SIGNED");
    expect(ev && ev.credentialId).toBe(DRAFTER_CRED);
    expect(ev && ev.clientDataJSON).toBe("cd");
  });

  it("401 when the assertion fails verification", async () => {
    const docId = await draft();
    assertionOk = false;
    await request(buildApp()).post("/v1/bilateral/sign-as-drafter").send(body(docId)).expect(401);
    const status = await service.getStatus(docId);
    expect(status.ok && status.value).toBe("DRAFT");
  });

  it("403 when the passkey is not the signed-in drafter's", async () => {
    const docId = await draft();
    // Credential belongs to a different user in the same company.
    col("webauthn_credentials")[DRAFTER_CRED] = { userId: "someone-else", companyId: DRAFTER, publicKey: "cose-x" };
    await request(buildApp()).post("/v1/bilateral/sign-as-drafter").send(body(docId)).expect(403);
  });

  it("401 without a company user", async () => {
    const docId = await draft();
    const app = express();
    app.use(express.json());
    app.use("/v1/bilateral", makeBilateralRouter({
      bilateralService: service, email: { sendBilateralRequest: vi.fn(async () => {}) } as never,
      counterpartyPortalBaseUrl: "https://portal.test",
    }));
    await request(app).post("/v1/bilateral/sign-as-drafter").send(body(docId)).expect(401);
  });
});
