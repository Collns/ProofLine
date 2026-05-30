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
        set:    async (data: unknown, opts?: { merge?: boolean }) => {
          store[col] = store[col] ?? {};
          if (opts?.merge && store[col][id]) {
            store[col][id] = { ...(store[col][id] as object), ...(data as object) };
          } else {
            store[col][id] = data as Record<string, unknown>;
          }
        },
        update: async (patch: Record<string, unknown>) => {
          if (!store[col]?.[id]) throw new Error(`Doc ${col}/${id} not found`);
          store[col][id] = { ...(store[col][id] as object), ...patch };
        },
      }),
      // PFL-067: minimal where().limit().get() shim — only supports
      // exact-match on a single field, which is all resolveCompanyIdByEmail
      // exercises. Returns docs in insertion order.
      where: (field: string, op: string, value: unknown) => {
        const matches = () => {
          const docs = store[col] ?? {};
          return Object.entries(docs)
            .filter(([, data]) => op === "==" && (data as Record<string, unknown>)[field] === value)
            .map(([id, data]) => ({ id, data: () => data }));
        };
        const build = (limit: number) => ({
          get: async () => {
            const docs = matches().slice(0, limit);
            return { empty: docs.length === 0, docs };
          },
        });
        return {
          limit: (n: number) => build(n),
          get:   async () => {
            const docs = matches();
            return { empty: docs.length === 0, docs };
          },
        };
      },
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
  it("auto-links a new user to a company that matches their email domain (PFL-067)", async () => {
    store["companies"] = {
      "co-acme": { companyId: "co-acme", domain: "acme.com" },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-abc", email: "alice@acme.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-1" })
      .expect(200);

    expect(res.body.authToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.body.userId).toBe("user-abc");
    expect(res.body.companyId).toBe("co-acme");
    expect(res.body.email).toBe("alice@acme.com");
    expect(res.body.needsOnboarding).toBeUndefined();

    const userDoc = store["users"]!["user-abc"] as Record<string, unknown>;
    expect(userDoc["companyId"]).toBe("co-acme");
    expect(userDoc["status"]).toBe("active");
    // PFL-084: fresh user docs persist `devices: []`, NOT a flat
    // `credentialId` placeholder string.
    expect(userDoc["credentialId"]).toBeUndefined();
    expect(userDoc["devices"]).toEqual([]);
    // PFL-088: fresh user docs persist policy fields so validatePolicy
    // doesn't have to apply the firestore-policy-context.ts safety-net
    // defaults — and so the wire path doesn't trip at $0.
    expect(userDoc["role"]).toBe("owner");
    expect(userDoc["wireLimitUsd"]).toBe(500_000);
    expect(userDoc["dailyLimitUsd"]).toBe(2_000_000);
    // Response still surfaces the placeholder so the popup knows it must
    // run a WebAuthn registration before signing.
    expect(res.body.credentialId).toBe("placeholder-credential-id");
  });

  it("flags needsOnboarding when no company matches the email domain (PFL-067)", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-no-co", email: "bob@unknown-co.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-1" })
      .expect(200);

    expect(res.body.companyId).toBe("");
    expect(res.body.needsOnboarding).toBe(true);

    const userDoc = store["users"]!["user-no-co"] as Record<string, unknown>;
    expect(userDoc["companyId"]).toBe("");
    expect(userDoc["status"]).toBe("pending");
  });

  it("never auto-links public email providers like gmail.com (PFL-067)", async () => {
    // Even if a malicious / mis-onboarded "gmail.com" company exists,
    // gmail users must NOT be linked into it.
    store["companies"] = {
      "co-gmail-trap": { companyId: "co-gmail-trap", domain: "gmail.com" },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-gmail", email: "someone@gmail.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-1" })
      .expect(200);

    expect(res.body.companyId).toBe("");
    expect(res.body.needsOnboarding).toBe(true);
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

  it("re-uses an existing users/{uid} record and surfaces devices[0].credentialId", async () => {
    // PFL-084: persisted user doc shape — devices is an array of
    // DeviceRecord, not a flat credentialId field.
    store["users"] = {
      "user-existing": {
        userId:    "user-existing",
        email:     "carol@acme.com",
        companyId: "co-acme",
        devices:   [
          {
            credentialId: "cred-real-abc",
            publicKey:    "spki-base64-existing",
            enrolledAt:   1700000000000,
          },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
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
    expect(res.body.email).toBe("carol@acme.com");

    // PFL-088 regression guard: the existing-user path must NEVER overwrite
    // policy fields. The seeded fixture has no role/wireLimitUsd — the
    // doc should still lack them after the auth refresh (would-be-clobber
    // would surface as the defaults sneaking into a customized doc).
    const userDoc = store["users"]!["user-existing"] as Record<string, unknown>;
    expect(userDoc["role"]).toBeUndefined();
    expect(userDoc["wireLimitUsd"]).toBeUndefined();
    expect(userDoc["dailyLimitUsd"]).toBeUndefined();
    expect(userDoc["status"]).toBeUndefined();
  });

  it("re-resolves companyId for existing users stamped with the legacy 'dev-company' sentinel (PFL-067)", async () => {
    store["companies"] = {
      "co-acme": { companyId: "co-acme", domain: "acme.com" },
    };
    store["users"] = {
      "user-legacy": {
        userId:    "user-legacy",
        email:     "dave@acme.com",
        companyId: "dev-company",
        devices:   [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-legacy", email: "dave@acme.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-x" })
      .expect(200);

    expect(res.body.companyId).toBe("co-acme");
    expect(res.body.needsOnboarding).toBeUndefined();

    const userDoc = store["users"]!["user-legacy"] as Record<string, unknown>;
    expect(userDoc["companyId"]).toBe("co-acme");
  });

  it("leaves an existing user's real companyId alone even if the domain doesn't match (PFL-067)", async () => {
    // An owner may have manually set the user's companyId to something
    // their email domain wouldn't resolve to (e.g. consultant working
    // under a client's company). The refresh path must not clobber that.
    store["companies"] = {
      "co-other": { companyId: "co-other", domain: "other.com" },
    };
    store["users"] = {
      "user-consultant": {
        userId:    "user-consultant",
        email:     "alex@personal-domain.com",
        companyId: "co-other",
        devices:   [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "user-consultant", email: "alex@personal-domain.com" }),
    });

    const res = await request(app)
      .post("/v1/extension/auth")
      .send({ idToken: "fake.firebase.idtoken.value", extInstallId: "ext-install-y" })
      .expect(200);

    expect(res.body.companyId).toBe("co-other");
    const userDoc = store["users"]!["user-consultant"] as Record<string, unknown>;
    expect(userDoc["companyId"]).toBe("co-other");
  });
});
