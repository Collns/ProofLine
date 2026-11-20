/**
 * PFL-166 — bilateral routes: drafter routes need a company user,
 * document reads are limited to the two parties (or a scoped link token),
 * and the counterparty identity comes from the signed link token.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { makeBilateralService, makeMemoryStore } from "@proofline/bilateral";
import type { BilateralService } from "@proofline/bilateral";

import { makeBilateralRouter } from "../router.js";
import { buildCounterpartyJwsLink, verifyCounterpartyJwsToken } from "../jws.helpers.js";

const NOW = 1_800_000_000;

function tokenFromLink(link: string): string {
  return decodeURIComponent(new URL(link).searchParams.get("t")!);
}

let service: BilateralService;

function buildApp(user?: { userId: string; companyId: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as unknown as { user: unknown }).user = user;
    next();
  });
  app.use(
    "/v1/bilateral",
    makeBilateralRouter({
      bilateralService:          service,
      email:                     { sendBilateralRequest: vi.fn(async () => {}) } as never,
      counterpartyPortalBaseUrl: "https://portal.test",
    }),
  );
  return app;
}

async function pendingDoc(): Promise<string> {
  const docId = "doc_test_0001";
  const draft = await service.draftDocument({
    docId,
    docType:               "banking_change",
    drafterCompanyId:      "co-drafter",
    counterpartyCompanyId: "co-counterparty",
    content:               { account: "****1234" },
    expiresInSeconds:      7 * 24 * 3600,
    nonce:                 "n".repeat(32),
  } as never);
  expect(draft.ok).toBe(true);
  const signed = await service.signAsDrafter(docId, { userId: "u-d", companyId: "co-drafter" }, "sig-d");
  expect(signed.ok).toBe(true);
  return docId;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  service = makeBilateralService({ store: makeMemoryStore(), now: () => NOW });
});

describe("drafter routes", () => {
  it("401 for draft / sign-as-drafter / revoke without a company user", async () => {
    const app = buildApp();
    await request(app).post("/v1/bilateral/draft").send({}).expect(401);
    await request(app).post("/v1/bilateral/sign-as-drafter").send({}).expect(401);
    await request(app).post("/v1/bilateral/doc_x/revoke").send({}).expect(401);
  });
});

describe("GET /v1/bilateral/:id", () => {
  it("allows either party's company", async () => {
    const docId = await pendingDoc();
    await request(buildApp({ userId: "u1", companyId: "co-drafter" })).get(`/v1/bilateral/${docId}`).expect(200);
    await request(buildApp({ userId: "u2", companyId: "co-counterparty" })).get(`/v1/bilateral/${docId}`).expect(200);
  });

  it("403 for a signed-in user of an unrelated company", async () => {
    const docId = await pendingDoc();
    await request(buildApp({ userId: "u3", companyId: "co-other" })).get(`/v1/bilateral/${docId}`).expect(403);
  });

  it("allows a link token scoped to the same document only", async () => {
    const docId = await pendingDoc();
    const link = await buildCounterpartyJwsLink({
      baseUrl: "https://portal.test", docId, drafterCompanyId: "co-drafter",
      counterpartyCompanyId: "co-counterparty", expiresAt: NOW + 3600,
    });
    const app = buildApp();
    await request(app).get(`/v1/bilateral/${docId}`).set("X-ProofLine-Bilateral-Token", tokenFromLink(link)).expect(200);
    await request(app).get(`/v1/bilateral/other_doc`).set("X-ProofLine-Bilateral-Token", tokenFromLink(link)).expect(401);
    await request(app).get(`/v1/bilateral/${docId}`).expect(401);
  });
});

// The counterparty-signing flow (PFL-182: server-issued challenge + verified
// WebAuthn assertion + identity from the token's `cp` claim) is covered end to
// end in sign-as-counterparty.test.ts, which stubs Firestore + finishAssertion.

describe("verifyCounterpartyJwsToken", () => {
  it("returns the counterparty claim and rejects a payload with the claim removed", async () => {
    const link = await buildCounterpartyJwsLink({
      baseUrl: "https://portal.test", docId: "d1", drafterCompanyId: "co-d",
      counterpartyCompanyId: "co-c", expiresAt: NOW + 60,
    });
    const good = await verifyCounterpartyJwsToken(tokenFromLink(link));
    expect(good).toMatchObject({ ok: true, docId: "d1", counterpartyId: "co-c" });

    // Swapping in a payload without `cp` breaks the signature.
    const [h, , s] = tokenFromLink(link).split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "d1", iss: "proofline-bilateral", exp: NOW + 60 })).toString("base64url")}.${s}`;
    expect((await verifyCounterpartyJwsToken(tampered)).ok).toBe(false);
  });
});
