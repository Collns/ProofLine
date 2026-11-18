/**
 * PFL-167 — finalize has no demo bypass: the caller must be the owner and
 * every onboarding gate (DNS, email, KYB, officer identity) must be met
 * before the company root key is created.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: Boolean(store[col]?.[id]), data: () => store[col]?.[id] ?? null }),
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          store[col] = store[col] ?? {};
          store[col][id] = opts?.merge ? { ...(store[col][id] ?? {}), ...data } : data;
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
import { firstUnmetGate } from "../finalize.handler.js";

const kmsProvider = {
  createCompanyRootKey: vi.fn(async (cid: string) => ({ keyName: `kms/${cid}` })),
  signWithKms:          vi.fn(async () => "c2ln"),
  exportPublicKey:      vi.fn(async () => "MFkw"),
};
const stripeIdentityProvider = { verifyOfficer: vi.fn() };

function buildApp(userId: string) {
  const app = express();
  app.use(express.json());
  app.use(
    "/v1/onboard",
    (req, _res, next) => { (req as unknown as { user: unknown }).user = { userId }; next(); },
    makeOnboardingRouter({
      sendVerificationCode:   vi.fn(async () => {}),
      kybProvider:            { verifyBusiness: vi.fn(), verifyOfficer: vi.fn() } as never,
      stripeIdentityProvider: stripeIdentityProvider as never,
      kmsProvider:            kmsProvider as never,
      anchorProvider:         { buildTree: () => ({ root: "0xroot" }), postAnchor: async () => ({ txHash: "0xtx", blockNumber: 1 }) } as never,
    }),
  );
  return app;
}

function seed(overrides: Record<string, unknown> = {}) {
  store["companies"] = store["companies"] ?? {};
  store["companies"]["co-1"] = {
    companyId:         "co-1",
    domain:            "acme.test",
    legalName:         "Acme Title LLC",
    ein:               "12-3456789",
    state:             "CA",
    ownerUserId:       "uid-owner",
    ownerEmail:        "owner@acme.test",
    onboardingStatus:  "pending_finalize",
    dnsToken:          "t",
    dnsVerifiedAt:     1,
    emailVerifiedAt:   2,
    kybResult:         { ok: true, vendorRef: "k", flags: [], officers: [], verifiedAt: 3 },
    officerEnrollment: { stripeSessionId: "vs", stripeClientSecret: "", officerEmail: "owner@acme.test", verifiedAt: 4 },
    createdAt:         0,
    updatedAt:         0,
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
});

describe("POST /v1/onboard/finalize — gates", () => {
  it("finalizes when the owner calls with every gate met", async () => {
    seed();
    const res = await request(buildApp("uid-owner")).post("/v1/onboard/finalize").send({ companyId: "co-1" }).expect(200);
    expect(res.body.status).toBe("verified");
    expect(kmsProvider.createCompanyRootKey).toHaveBeenCalledOnce();
  });

  it("403 for anyone but the owner, even with demoMode in the body", async () => {
    seed();
    await request(buildApp("uid-other")).post("/v1/onboard/finalize")
      .send({ companyId: "co-1", demoMode: true }).expect(403);
    expect(kmsProvider.createCompanyRootKey).not.toHaveBeenCalled();
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ["DNS",   { dnsVerifiedAt: undefined },                                   "DNS_NOT_VERIFIED"],
    ["email", { emailVerifiedAt: undefined },                                 "EMAIL_NOT_VERIFIED"],
    ["KYB missing", { kybResult: undefined },                                 "KYB_INCOMPLETE"],
    ["KYB failed",  { kybResult: { ok: false, vendorRef: "k", flags: [], officers: [], verifiedAt: 3 } }, "KYB_FAILED"],
    ["officer",     { officerEnrollment: { stripeSessionId: "vs", stripeClientSecret: "", officerEmail: "o@acme.test" } }, "KYC_INCOMPLETE"],
  ];
  for (const [name, overrides, code] of cases) {
    it(`422 ${code} when the ${name} gate is unmet (demoMode is ignored)`, async () => {
      seed(overrides);
      const res = await request(buildApp("uid-owner")).post("/v1/onboard/finalize")
        .send({ companyId: "co-1", demoMode: true }).expect(422);
      expect(res.body.title).toBe(code);
      expect(kmsProvider.createCompanyRootKey).not.toHaveBeenCalled();
    });
  }

  it("409 for a company that is already verified or not yet at the KYC stage", async () => {
    seed({ onboardingStatus: "verified" });
    await request(buildApp("uid-owner")).post("/v1/onboard/finalize").send({ companyId: "co-1" }).expect(409);
    seed({ onboardingStatus: "pending_dns" });
    await request(buildApp("uid-owner")).post("/v1/onboard/finalize").send({ companyId: "co-1" }).expect(409);
  });

  it("firstUnmetGate reports gates in order", () => {
    expect(firstUnmetGate({})?.code).toBe("DNS_NOT_VERIFIED");
    expect(firstUnmetGate({ dnsVerifiedAt: 1, emailVerifiedAt: 1, kybResult: { ok: true }, officerEnrollment: { verifiedAt: 1 } })).toBeNull();
  });
});

describe("POST /v1/onboard/enroll-officer — synchronous verification", () => {
  it("records the officer as verified when the provider returns a completed result", async () => {
    seed({ onboardingStatus: "pending_kyc", officerEnrollment: undefined });
    stripeIdentityProvider.verifyOfficer.mockResolvedValueOnce({
      ok: true, vendorRef: "idv-1", documentVerified: true, livenessConfirmed: true, matchedExpected: true,
      raw: { clientSecret: null, sessionId: "idv-1" },
    });
    const res = await request(buildApp("uid-owner")).post("/v1/onboard/enroll-officer")
      .send({ companyId: "co-1", officerEmail: "owner@acme.test" }).expect(201);
    expect(res.body).toMatchObject({ verified: true, clientSecret: null });
    const company = store["companies"]!["co-1"]!;
    expect(company["onboardingStatus"]).toBe("pending_finalize");
    expect((company["officerEnrollment"] as { verifiedAt?: number }).verifiedAt).toBeGreaterThan(0);
  });

  it("keeps a pending session pending (webhook completes it)", async () => {
    seed({ onboardingStatus: "pending_kyc", officerEnrollment: undefined });
    stripeIdentityProvider.verifyOfficer.mockResolvedValueOnce({
      ok: false, vendorRef: "vs_2", documentVerified: false, livenessConfirmed: false, matchedExpected: false,
      raw: { clientSecret: "vs_2_secret", sessionId: "vs_2" },
    });
    const res = await request(buildApp("uid-owner")).post("/v1/onboard/enroll-officer")
      .send({ companyId: "co-1", officerEmail: "owner@acme.test" }).expect(201);
    expect(res.body.clientSecret).toBe("vs_2_secret");
    expect((store["companies"]!["co-1"]!["officerEnrollment"] as { verifiedAt?: number }).verifiedAt).toBeUndefined();
  });
});
