/**
 * @file extension-auth.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-061 — POST /v1/extension/auth contract tests.
 *
 * Mocks firebase-admin/firestore + firebase-admin/auth so the suite runs
 * without a live Firebase project. Mirrors the in-memory Firestore shim
 * used by api/onboarding/__tests__/onboarding.e2e.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock ────────────────────────────────────────────────

const store: Record<string, Record<string, unknown>> = {};

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get:    async () => ({
          exists: Boolean(store[col]?.[id]),
          data:   () => store[col]?.[id] ?? null,
        }),
        set:    async (data: unknown, _opts?: unknown) => {
          store[col] = store[col] ?? {};
          store[col][id] = data;
        },
        update: async (patch: Record<string, unknown>) => {
          if (!store[col]?.[id]) throw new Error(`Doc ${col}/${id} not found`);
          store[col][id] = { ...(store[col][id] as object), ...patch };
        },
      }),
    }),
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => makeFirestoreMock(),
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps:       vi.fn(() => [{ name: "[DEFAULT]" }]),
  getApp:        vi.fn(),
}));

// firebase-admin/auth is mocked but we override per-test by injecting
// verifyIdToken into the handler factory directly — keeps test surface tight.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      throw new Error("verifyIdToken should be injected in tests");
    }),
  }),
}));

import { makeExtensionAuthHandler } from "../extension-auth.handler.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function buildApp(opts: {
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
}) {
  const app = express();
  app.use(express.json());

  // Mirror index.ts CORS for the route under test.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-ProofLine-Challenge-Id, X-ProofLine-Bilateral-Token",
    );
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin === "https://proofline-sign.web.app") {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const handler = makeExtensionAuthHandler({ verifyIdToken: opts.verifyIdToken });
  app.post("/v1/extension/auth", (req, res, next) => {
    handler(req, res).catch(next);
  });

  return app;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/extension/auth", () => {
  it("returns a JWS authToken + userId + companyId for a valid ID token", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-abc", email: "alice@example.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-1" })
      .expect(200);

    expect(res.body.authToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.body.userId).toBe("user-abc");
    expect(typeof res.body.companyId).toBe("string");
    expect(res.body.companyId.length).toBeGreaterThan(0);
    expect(typeof res.body.credentialId).toBe("string");

    // The user record should have been auto-created in Firestore.
    expect(store["users"]?.["user-abc"]).toBeDefined();
    expect((store["users"]!["user-abc"] as { email: string }).email).toBe(
      "alice@example.com",
    );
  });

  it("returns 400 when idToken is missing from the body", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-x" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ extInstallId: "ext-install-1" })
      .expect(400);

    expect(res.body.title).toBe("Bad Request");
  });

  it("returns 401 when the Firebase ID token is invalid", async () => {
    const app = buildApp({
      verifyIdToken: async () => {
        throw new Error("Firebase ID token has been expired");
      },
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "expired.firebase.idtoken", extInstallId: "ext-install-1" })
      .expect(401);

    expect(res.body.title).toBe("Unauthorized");
  });

  it("emits the correct CORS headers for the web-sign origin", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-cors", email: "cors@example.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .set("Origin", "https://proofline-sign.web.app")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-1" })
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://proofline-sign.web.app",
    );
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("re-uses an existing users/{uid} record on subsequent calls", async () => {
    store["users"] = {
      "user-existing": {
        userId:       "user-existing",
        email:        "carol@acme.com",
        companyId:    "co-acme",
        credentialId: "cred-real-abc",
        createdAt:    1700000000000,
        updatedAt:    1700000000000,
      },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-existing", email: "carol@acme.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-2" })
      .expect(200);

    expect(res.body.userId).toBe("user-existing");
    expect(res.body.companyId).toBe("co-acme");
    expect(res.body.credentialId).toBe("cred-real-abc");
  });
});
