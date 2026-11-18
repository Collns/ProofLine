/**
 * PFL-166 — /v1/onboard/start takes the owner from the verified Firebase
 * ID token, never from the request body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: Boolean(store[col]?.[id]),
          data:   () => store[col]?.[id] ?? null,
        }),
        set: async (data: Record<string, unknown>) => {
          store[col] = store[col] ?? {};
          store[col][id] = data;
        },
        update: async (patch: Record<string, unknown>) => {
          store[col]![id] = { ...store[col]![id], ...patch };
        },
      }),
      where: (field: string, _op: string, value: unknown) => ({
        limit: (_n: number) => ({
          get: async () => {
            const docs = Object.values(store[col] ?? {}).filter((d) => d[field] === value);
            return { empty: docs.length === 0, docs: docs.map((d) => ({ data: () => d })) };
          },
        }),
      }),
    }),
  };
}

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => makeFirestoreMock() }));
vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => [{ name: "[DEFAULT]" }]),
  getApp: vi.fn(),
}));

import { makeOnboardingRouter } from "../router.js";
import { makeFirebaseAuth } from "../../../auth/firebase-auth.middleware.js";

const verifyIdToken = vi.fn(async (token: string) => {
  const uid = { "tok-alice": "uid-alice", "tok-bob": "uid-bob" }[token];
  if (!uid) throw new Error("invalid token");
  return { uid };
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/v1/onboard",
    makeFirebaseAuth({ requireCompany: false }, { verifyIdToken }),
    makeOnboardingRouter({
      sendVerificationCode:   vi.fn(async () => {}),
      kybProvider:            { verifyBusiness: vi.fn(), verifyOfficer: vi.fn() } as never,
      stripeIdentityProvider: { verifyOfficer: vi.fn() } as never,
      kmsProvider:            { createCompanyRootKey: vi.fn(), signWithKms: vi.fn(), exportPublicKey: vi.fn() } as never,
      anchorProvider:         { buildTree: vi.fn(), postAnchor: vi.fn() } as never,
    }),
  );
  return app;
}

const body = {
  domain:     "acme.test",
  legalName:  "Acme Title LLC",
  ein:        "12-3456789",
  state:      "CA",
  ownerEmail: "alice@acme.test",
};

describe("POST /v1/onboard/start — owner identity", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("401 without a Firebase ID token", async () => {
    await request(buildApp()).post("/v1/onboard/start").send(body).expect(401);
  });

  it("records the token's uid as owner and ignores body.ownerUserId", async () => {
    const res = await request(buildApp())
      .post("/v1/onboard/start")
      .set("Authorization", "Bearer tok-alice")
      .send({ ...body, ownerUserId: "uid-mallory" })
      .expect(201);
    const company = store["companies"]![res.body.companyId]!;
    expect(company["ownerUserId"]).toBe("uid-alice");
  });

  it("refuses a restart by another account once DNS is verified", async () => {
    const app = buildApp();
    const first = await request(app)
      .post("/v1/onboard/start")
      .set("Authorization", "Bearer tok-alice")
      .send(body)
      .expect(201);
    store["companies"]![first.body.companyId]!["dnsVerifiedAt"] = Date.now();

    const res = await request(app)
      .post("/v1/onboard/start")
      .set("Authorization", "Bearer tok-bob")
      .send(body)
      .expect(409);
    expect(res.body.title).toBe("DOMAIN_IN_PROGRESS");
    expect(store["companies"]![first.body.companyId]!["ownerUserId"]).toBe("uid-alice");
  });

  it("lets the same owner restart their own onboarding", async () => {
    const app = buildApp();
    const first = await request(app)
      .post("/v1/onboard/start")
      .set("Authorization", "Bearer tok-alice")
      .send(body)
      .expect(201);
    store["companies"]![first.body.companyId]!["dnsVerifiedAt"] = Date.now();
    const again = await request(app)
      .post("/v1/onboard/start")
      .set("Authorization", "Bearer tok-alice")
      .send(body)
      .expect(201);
    expect(again.body.companyId).toBe(first.body.companyId);
  });

  it("protects the other onboarding steps too", async () => {
    await request(buildApp())
      .post("/v1/onboard/verify-dns")
      .send({ companyId: "any" })
      .expect(401);
  });
});
