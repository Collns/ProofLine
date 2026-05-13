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

import {
  makeRegisterCredentialHandler,
  type CoseExtractInput,
  type CoseExtractResult,
} from "../register-credential.handler.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// PFL-094: a fake COSE buffer the stub extractor returns. Starts with the
// CBOR map-of-5 prefix (0xa5) — the same shape SimpleWebAuthn produces
// for an EC P-256 key, so any "is this really COSE?" sanity check on the
// stored bytes passes.
const FAKE_COSE_BYTES = Buffer.concat([
  Buffer.from([0xa5]),
  Buffer.from(new Uint8Array(76).fill(9)),
]);
const FAKE_COSE_B64 = FAKE_COSE_BYTES.toString("base64");

function stubCoseExtractor(): (input: CoseExtractInput) => Promise<CoseExtractResult> {
  return async () => ({ ok: true, coseB64: FAKE_COSE_B64 });
}

function buildApp(opts: {
  verifyAuthBearer?: Parameters<typeof makeRegisterCredentialHandler>[0] extends infer T
    ? T extends { verifyAuthBearer?: infer F }
      ? F
      : never
    : never;
  extractCose?: (input: CoseExtractInput) => Promise<CoseExtractResult>;
} = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRegisterCredentialHandler({
    ...opts,
    // Default to a passing stub so tests can focus on the handler's
    // business logic without crafting real attestation bytes. Tests that
    // explicitly want to exercise rejection inject their own.
    extractCose: opts.extractCose ?? stubCoseExtractor(),
  });
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
  const secret = process.env["PROOFLINE_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod";
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
  it("stores the credential and appends a DeviceRecord to users/{userId}.devices", async () => {
    // Fresh user shape per PFL-084: `devices: []` (no flat credentialId field).
    store["users"] = {
      "user-abc": {
        userId:    "user-abc",
        email:     "alice@example.com",
        companyId: "dev-company",
        devices:   [],
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
      // PFL-094: stored publicKey is COSE bytes extracted from
      // attestationObject (NOT the client-supplied SPKI in validBody.publicKey).
      publicKey:    FAKE_COSE_B64,
      deviceName:   "Mac",
    });
    expect(typeof cred["createdAt"]).toBe("number");

    // PFL-084: user.devices[] must contain a DeviceRecord for the new
    // credentialId, and the flat user.credentialId field must NOT exist.
    const userDoc = store["users"]?.["user-abc"] as Record<string, unknown>;
    expect(userDoc["credentialId"]).toBeUndefined();
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(Array.isArray(devices)).toBe(true);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      credentialId: validBody.credentialId,
      // PFL-094: device publicKey is the SAME COSE bytes written to the
      // webauthn_credentials doc — never the client's SPKI value.
      publicKey:    FAKE_COSE_B64,
    });
    expect(typeof devices[0]?.["enrolledAt"]).toBe("number");
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

  it("creates a minimal users/{userId} doc with devices:[deviceRecord] when none exists yet", async () => {
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
      userId:    "user-fresh",
      companyId: "co-fresh",
    });
    expect(u["credentialId"]).toBeUndefined();
    // PFL-088: the edge-case path that creates a brand-new user doc from
    // register-credential must seed the same policy fields that
    // extension-auth.handler.ts writes on first-auth — otherwise this
    // user would hit POLICY_AUTHORITY_EXCEEDED on any wire instruction.
    expect(u["role"]).toBe("owner");
    expect(u["status"]).toBe("active");
    expect(u["wireLimitUsd"]).toBe(500_000);
    expect(u["dailyLimitUsd"]).toBe(2_000_000);
    const devices = u["devices"] as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      credentialId: validBody.credentialId,
      // PFL-094: persisted publicKey is COSE bytes from the attestation,
      // not the client-supplied SPKI in validBody.publicKey.
      publicKey:    FAKE_COSE_B64,
    });
  });

  it("appends a second device on multi-device enrolment instead of overwriting", async () => {
    // PFL-084 / multi-device: registering a new credentialId for a user
    // who already has a device must APPEND, not overwrite.
    const existingDevice = {
      credentialId: "cred-existing-real-001",
      publicKey:    "spki-existing",
      enrolledAt:   NOW_SEC * 1000 - 86_400_000,
    };
    store["users"] = {
      "user-multi": {
        userId:    "user-multi",
        companyId: "co-multi",
        devices:   [existingDevice],
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

    const userDoc = store["users"]?.["user-multi"] as Record<string, unknown>;
    expect(userDoc["credentialId"]).toBeUndefined();
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d["credentialId"])).toEqual([
      "cred-existing-real-001",
      "cred-second-device-002",
    ]);
    expect(store["webauthn_credentials"]?.["cred-second-device-002"]).toBeDefined();
  });

  // PFL-084 regression guard. The bug: register-credential used to write
  // `users/{userId}.credentialId = X` as a flat string, but validatePolicy
  // (and sign-finalize) call `user.devices.find(d => d.credentialId === ...)`
  // — so the array was always undefined and DEVICE_INVALID fired. Confirm
  // the persisted shape now satisfies the consumer's expectation.
  it("PFL-084: user document is readable as UserRecord.devices by sign-finalize", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-readable", companyId: "co-readable", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);

    // Simulate what sign-finalize does after ctx.getUser(userId):
    //   const device = user.devices.find((d) => d.credentialId === ...);
    const userDoc = store["users"]?.["user-readable"] as {
      devices?: Array<{ credentialId: string; publicKey: string; enrolledAt: number }>;
    };
    const device = userDoc.devices?.find((d) => d.credentialId === validBody.credentialId);
    expect(device).toBeDefined();
    // PFL-094: this is COSE bytes from the (stubbed) attestation, not
    // the SPKI string in validBody.publicKey.
    expect(device?.publicKey).toBe(FAKE_COSE_B64);
    expect(typeof device?.enrolledAt).toBe("number");
  });

  // ── PFL-094: COSE-from-attestation extraction ─────────────────────────────

  it("PFL-094: stores COSE bytes (extracted from attestation), not the client-supplied SPKI", async () => {
    store["users"] = {
      "user-cose": {
        userId:    "user-cose",
        companyId: "dev-company",
        devices:   [],
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId:       "user-cose",
        companyId:    "dev-company",
        extInstallId: "ext-cose",
        iat:          NOW_SEC,
        exp:          NOW_SEC + 3600,
      }),
      // Stub returns a buffer whose first byte is 0xa5 — CBOR map-of-5,
      // the canonical prefix of a COSE-encoded EC P-256 key. We assert
      // BOTH storage sites round-trip exactly those bytes (no double-
      // encoding, no SPKI bleed-through).
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);

    // Decode the stored value and confirm the COSE prefix.
    const cred = store["webauthn_credentials"]?.[validBody.credentialId] as Record<string, unknown>;
    const storedB64 = cred["publicKey"] as string;
    expect(storedB64).toBe(FAKE_COSE_B64);
    const storedBytes = Buffer.from(storedB64, "base64");
    expect(storedBytes[0]).toBe(0xa5);

    // Crucial: the SPKI value the client sent must NOT be stored anywhere
    // as the canonical publicKey. (The raw attestationObject + clientDataJSON
    // are still archived under their own field names; that's fine.)
    expect(storedB64).not.toBe(validBody.publicKey);

    // The device entry on the user doc carries the same COSE bytes.
    const userDoc = store["users"]?.["user-cose"] as Record<string, unknown>;
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(devices[0]?.["publicKey"]).toBe(FAKE_COSE_B64);
  });

  it("PFL-094: returns 400 ATTESTATION_INVALID when the attestation cannot be parsed", async () => {
    store["users"] = {
      "user-bad-attest": {
        userId:    "user-bad-attest",
        companyId: "dev-company",
        devices:   [],
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId:       "user-bad-attest",
        companyId:    "dev-company",
        extInstallId: "ext-x",
        iat:          NOW_SEC,
        exp:          NOW_SEC + 3600,
      }),
      // Inject an extractor that always rejects — mirrors what the real
      // verifyRegistrationResponse does on `attestationObject: "AAAA"`
      // (invalid CBOR). Goal: prove the handler returns 400 rather than
      // 500-ing on garbage input.
      extractCose: async () => ({ ok: false, reason: "Invalid CBOR in attestationObject" }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ ...validBody, attestationObject: "AAAA" })
      .expect(400);

    expect(res.body.title).toBe("ATTESTATION_INVALID");
    expect(res.body.status).toBe(400);
    expect(res.body.detail).toMatch(/CBOR|Invalid|attestation/i);

    // Nothing should have been persisted on the failure path.
    expect(store["webauthn_credentials"]?.[validBody.credentialId]).toBeUndefined();
    const userDoc = store["users"]?.["user-bad-attest"] as Record<string, unknown>;
    expect((userDoc["devices"] as unknown[])).toHaveLength(0);
  });
});
