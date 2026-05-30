/**
 * @file registration-challenge.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-095 — POST /v1/auth/challenge contract tests.
 *
 * Mirrors the in-memory Firestore shim used by extension-auth.test.ts.
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
        get: async () => ({
          exists: Boolean(store[col]?.[id]),
          data:   () => store[col]?.[id] ?? null,
        }),
        set: async (data: unknown) => {
          store[col] = store[col] ?? {};
          store[col][id] = data as Record<string, unknown>;
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

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      throw new Error("not used in registration-challenge tests");
    }),
  }),
}));

import {
  makeRegistrationChallengeHandler,
  REGISTRATION_CHALLENGE_PURPOSE,
  REGISTRATION_CHALLENGE_TTL_MS,
} from "../registration-challenge.handler.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(opts: Parameters<typeof makeRegistrationChallengeHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRegistrationChallengeHandler(opts);
  app.post("/v1/auth/challenge", (req, res, next) => {
    handler(req, res).catch(next);
  });
  return app;
}

function okVerify(userId = "user-abc", companyId = "co-abc") {
  return (() => ({
    ok:     true as const,
    claims: { userId, companyId, extInstallId: "ext-1", iat: 1, exp: 2_000_000_000 },
  })) as Parameters<typeof makeRegistrationChallengeHandler>[0]["verifyAuthorization"];
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/auth/challenge", () => {
  it("issues a base64url challenge and persists pending_challenges/{challengeId}", async () => {
    const fixedChallenge = Buffer.from(new Uint8Array(32).fill(1));
    const fixedChallengeId = Buffer.from(new Uint8Array(16).fill(2));
    // Two calls: first for the challenge bytes (32), second for the
    // challengeId (16). Return them in order.
    const queue = [fixedChallenge, fixedChallengeId];
    const app = buildApp({
      randomBytes:        (_n: number) => queue.shift() ?? Buffer.alloc(0),
      verifyAuthorization: okVerify("user-abc", "co-abc"),
      now:                () => 1_700_000_000_000,
    });

    const res = await request(app)
      .post("/v1/auth/challenge")
      .set("Authorization", "Bearer doesnt-matter")
      .send({})
      .expect(200);

    expect(res.body.challenge).toBe(fixedChallenge.toString("base64url"));
    expect(res.body.challengeId).toBe(fixedChallengeId.toString("base64url"));
    expect(res.body.expiresAt).toBe(1_700_000_000_000 + REGISTRATION_CHALLENGE_TTL_MS);

    const stored = store["pending_challenges"]?.[res.body.challengeId] as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(stored["challenge"]).toBe(res.body.challenge);
    expect(stored["userId"]).toBe("user-abc");
    expect(stored["companyId"]).toBe("co-abc");
    expect(stored["purpose"]).toBe(REGISTRATION_CHALLENGE_PURPOSE);
    expect(stored["createdAt"]).toBe(1_700_000_000_000);
    expect(stored["expiresAt"]).toBe(1_700_000_000_000 + REGISTRATION_CHALLENGE_TTL_MS);
  });

  it("returns 401 when the Bearer fails verification", async () => {
    const app = buildApp({
      verifyAuthorization: () => ({
        ok:     false,
        code:   "INVALID_TOKEN",
        detail: "bad sig",
      }),
    });

    const res = await request(app)
      .post("/v1/auth/challenge")
      .set("Authorization", "Bearer nope")
      .send({})
      .expect(401);

    expect(res.body.title).toBe("Unauthorized");
    expect(Object.keys(store)).not.toContain("pending_challenges");
  });

  it("returns 401 when the Authorization header is absent", async () => {
    const app = buildApp({
      // Default verifier sees `undefined` and returns NO_AUTH_TOKEN.
    });
    await request(app).post("/v1/auth/challenge").send({}).expect(401);
  });

  it("optionally binds the issued challenge to a credentialId when supplied", async () => {
    const fixedChallenge = Buffer.from(new Uint8Array(32).fill(3));
    const fixedChallengeId = Buffer.from(new Uint8Array(16).fill(4));
    const queue = [fixedChallenge, fixedChallengeId];
    const app = buildApp({
      randomBytes:        (_n: number) => queue.shift() ?? Buffer.alloc(0),
      verifyAuthorization: okVerify(),
    });

    const res = await request(app)
      .post("/v1/auth/challenge")
      .set("Authorization", "Bearer x")
      .send({ credentialId: "cred-bound-001" })
      .expect(200);

    const stored = store["pending_challenges"]?.[res.body.challengeId] as Record<string, unknown>;
    expect(stored["credentialId"]).toBe("cred-bound-001");
  });

  it("issues unique challenges across calls", async () => {
    // Use the real crypto.randomBytes so we exercise actual entropy.
    const app = buildApp({ verifyAuthorization: okVerify() });

    const a = await request(app).post("/v1/auth/challenge").set("Authorization", "Bearer x").send({}).expect(200);
    const b = await request(app).post("/v1/auth/challenge").set("Authorization", "Bearer x").send({}).expect(200);

    expect(a.body.challenge).not.toBe(b.body.challenge);
    expect(a.body.challengeId).not.toBe(b.body.challengeId);
    expect(Object.keys(store["pending_challenges"] ?? {})).toHaveLength(2);
  });
});
