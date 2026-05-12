/**
 * @file register-credential.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-069 — POST /v1/extension/register-credential contract tests.
 *
 * Strategy: in-memory Firestore mock (mirrors extension-auth.test.ts and
 * onboarding e2e). verifyAuthBearer is injected so we don't need to mint
 * real HMAC JWS tokens — but one test exercises the default verifier with
 * a real HMAC to confirm the JWS path also works end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import * as crypto from "node:crypto";

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
        set:    async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          store[col] = store[col] ?? {};
          if (opts?.merge) {
            store[col][id] = { ...(store[col][id] as object ?? {}), ...data };
          } else {
            store[col][id] = data;
          }
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
      throw new Error("not used in register-credential tests");
    }),
  }),
}));

import { makeRegisterCredentialHandler } from "../register-credential.handler.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(opts: {
  verifyAuthBearer?: Parameters<typeof makeRegisterCredentialHandler>[0] extends infer T
    ? T extends { verifyAuthBearer?: infer F }
      ? F
      : never
    : never;
} = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRegisterCredentialHandler(opts);
  app.post("/v1/extension/register-credential", (req, res, next) => {
    handler(req, res).catch(next);
  });
  return app;
}

function mintRealAuthJws(claims: {
  userId: string;
  companyId: string;
  extInstallId: string;
  iat: number;
  exp: number;
}): string {
  const secret = process.env["EXT_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod";
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ v: 1, iss: "proofline-extension-auth", ...claims })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const validBody = {
  credentialId:      "cred-touchid-abc-001",
  publicKey:         "MFkwEwYHKoZIzj0CAQYI-test-spki-bytes",
  attestationObject: "o2NmbXRkbm9uZS-test-attestation",
  clientDataJSON:    "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0-test",
  deviceName:        "Mac",
};

const NOW_SEC = Math.floor(Date.now() / 1000);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/extension/register-credential", () => {
  it("stores the credential and updates users/{userId}.credentialId from placeholder", async () => {
    store["users"] = {
      "user-abc": {
        userId:       "user-abc",
        email:        "alice@example.com",
        companyId:    "dev-company",
        credentialId: "placeholder-credential-id",
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId:       "user-abc",
        companyId:    "dev-company",
        extInstallId: "ext-install-1",
        iat:          NOW_SEC,
        exp:          NOW_SEC + 3600,
      }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer doesnt-matter-stubbed")
      .send(validBody)
      .expect(200);

    expect(res.body).toEqual({ ok: true, credentialId: validBody.credentialId });

    const cred = store["webauthn_credentials"]?.[validBody.credentialId] as Record<string, unknown>;
    expect(cred).toMatchObject({
      credentialId: validBody.credentialId,
      userId:       "user-abc",
      companyId:    "dev-company",
      publicKey:    validBody.publicKey,
      deviceName:   "Mac",
    });
    expect(typeof cred["createdAt"]).toBe("number");

    expect((store["users"]?.["user-abc"] as Record<string, unknown>)["credentialId"])
      .toBe(validBody.credentialId);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildApp({
      verifyAuthBearer: () => null, // never reached
    });
    const res = await request(app)
      .post("/v1/extension/register-credential")
      .send(validBody)
      .expect(401);
    expect(res.body.title).toBe("Unauthorized");
  });

  it("returns 401 when the Bearer token fails verification", async () => {
    const app = buildApp({
      verifyAuthBearer: () => null,
    });
    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer not-a-real-jws")
      .send(validBody)
      .expect(401);
    expect(res.body.title).toBe("Unauthorized");
  });

  it("returns 400 when body fields are missing", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "u", companyId: "c", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });
    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ credentialId: "only-id" })
      .expect(400);
    expect(res.body.title).toBe("Bad Request");
  });

  it("is idempotent: re-registering the same credentialId for the same user returns 200", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-x", companyId: "co-x", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });
    store["users"] = { "user-x": { userId: "user-x", companyId: "co-x" } };

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);
    expect(res.body).toEqual({ ok: true, credentialId: validBody.credentialId });
  });

  it("returns 409 when the credentialId is already registered to a different user", async () => {
    store["webauthn_credentials"] = {
      [validBody.credentialId]: {
        credentialId: validBody.credentialId,
        userId:       "user-someone-else",
        companyId:    "co-someone-else",
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-attacker", companyId: "co-attacker", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(409);
    expect(res.body.title).toBe("CREDENTIAL_ALREADY_REGISTERED");
  });

  it("accepts a real HMAC-signed Bearer when verifyAuthBearer is the default", async () => {
    const token = mintRealAuthJws({
      userId:       "user-real",
      companyId:    "co-real",
      extInstallId: "ext-1",
      iat:          NOW_SEC,
      exp:          NOW_SEC + 3600,
    });
    const app = buildApp(); // default verifier

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody)
      .expect(200);
    expect(res.body).toEqual({ ok: true, credentialId: validBody.credentialId });

    expect((store["webauthn_credentials"]?.[validBody.credentialId] as Record<string, unknown>)["userId"])
      .toBe("user-real");
  });

  it("creates a minimal users/{userId} doc when none exists yet", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-fresh", companyId: "co-fresh", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);

    const u = store["users"]?.["user-fresh"] as Record<string, unknown>;
    expect(u).toMatchObject({
      userId:       "user-fresh",
      companyId:    "co-fresh",
      credentialId: validBody.credentialId,
    });
  });

  it("does NOT overwrite an existing real credentialId on a fresh enrolment", async () => {
    store["users"] = {
      "user-multi": {
        userId:       "user-multi",
        companyId:    "co-multi",
        credentialId: "cred-existing-real-001",
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-multi", companyId: "co-multi", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ ...validBody, credentialId: "cred-second-device-002" })
      .expect(200);

    expect((store["users"]?.["user-multi"] as Record<string, unknown>)["credentialId"])
      .toBe("cred-existing-real-001");
    expect(store["webauthn_credentials"]?.["cred-second-device-002"]).toBeDefined();
  });
});
