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

interface DocRef {
  __path: { col: string; id: string };
  get: () => Promise<{ exists: boolean; data: () => unknown }>;
  set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  collection: (sub: string) => CollectionRef;
}
interface CollectionRef {
  doc: (id: string) => DocRef;
}

function writeAt(col: string, id: string, data: Record<string, unknown>, merge?: boolean): void {
  store[col] = store[col] ?? {};
  if (merge) {
    store[col][id] = { ...(store[col][id] as object ?? {}), ...data };
  } else {
    store[col][id] = data;
  }
}

function makeCollectionRef(col: string): CollectionRef {
  return {
    doc: (id: string): DocRef => ({
      __path: { col, id },
      get:    async () => ({
        exists: Boolean(store[col]?.[id]),
        data:   () => store[col]?.[id] ?? null,
      }),
      set:    async (data, opts) => writeAt(col, id, data, opts?.merge),
      // Sub-collections live under `${parentCol}/${docId}/${subCol}`.
      // PFL-100: register-credential writes role_credentials there.
      collection: (sub: string) => makeCollectionRef(`${col}/${id}/${sub}`),
    }),
  };
}

function makeFirestoreMock() {
  return {
    collection: (col: string) => makeCollectionRef(col),
    // PFL-100: register-credential uses a batch to atomically write
    // webauthn_credentials + users/{userId}/role_credentials.
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: DocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          ops.push(() => writeAt(ref.__path.col, ref.__path.id, data, opts?.merge));
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
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
  type ChallengeConsumeResult,
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

// PFL-095: default test challenge — base64url(32 bytes). We don't care
// about the actual entropy in tests; we care that the handler routes the
// value through consumeRegistrationChallenge before storing anything.
const TEST_CHALLENGE_B64URL = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");

function clientDataWithChallenge(challenge: string): string {
  // Real WebAuthn clientDataJSON shape (minus optional fields). The
  // handler only reads `.challenge`, so this is enough.
  const obj = {
    type:      "webauthn.create",
    challenge,
    origin:    "https://proofline-sign.web.app",
    crossOrigin: false,
  };
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function stubConsumeChallenge(opts: {
  ok?:        boolean;
  userId?:    string;
  companyId?: string;
  code?:      "CHALLENGE_INVALID" | "CHALLENGE_EXPIRED";
  detail?:    string;
} = {}): (input: { challenge: string; userId: string }) => Promise<ChallengeConsumeResult> {
  return async (input) => {
    if (opts.ok === false) {
      return {
        ok:     false,
        code:   opts.code   ?? "CHALLENGE_INVALID",
        detail: opts.detail ?? "stub-rejected",
      };
    }
    return {
      ok:     true,
      record: {
        challengeId: "ch-stub-001",
        challenge:   input.challenge,
        userId:      opts.userId    ?? input.userId,
        companyId:   opts.companyId ?? "co-stub",
        purpose:     "registration",
        createdAt:   Date.now() - 1000,
        expiresAt:   Date.now() + 60_000,
      },
    };
  };
}

function buildApp(opts: {
  verifyAuthBearer?: Parameters<typeof makeRegisterCredentialHandler>[0] extends infer T
    ? T extends { verifyAuthBearer?: infer F }
      ? F
      : never
    : never;
  extractCose?: (input: CoseExtractInput) => Promise<CoseExtractResult>;
  consumeRegistrationChallenge?: (input: { challenge: string; userId: string }) => Promise<ChallengeConsumeResult>;
} = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRegisterCredentialHandler({
    ...opts,
    // Default to a passing stub so tests can focus on the handler's
    // business logic without crafting real attestation bytes. Tests that
    // explicitly want to exercise rejection inject their own.
    extractCose: opts.extractCose ?? stubCoseExtractor(),
    // PFL-095: default to a stub that approves the challenge so existing
    // happy-path tests still pass without a live Firestore transaction
    // mock. Tests that exercise the reject paths inject their own.
    consumeRegistrationChallenge:
      opts.consumeRegistrationChallenge ?? stubConsumeChallenge(),
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
  // PFL-095: clientDataJSON now carries a real challenge that the handler
  // looks up in pending_challenges. The default consume stub accepts
  // whatever string lands here.
  clientDataJSON:    clientDataWithChallenge(TEST_CHALLENGE_B64URL),
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

  // ── PFL-095: server-issued challenge consumption ─────────────────────────

  it("PFL-095: rejects with 400 CHALLENGE_INVALID when the challenge is not in pending_challenges", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-no-chal", companyId: "co", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
      consumeRegistrationChallenge: stubConsumeChallenge({
        ok:     false,
        code:   "CHALLENGE_INVALID",
        detail: "Challenge not found — request a new one via POST /v1/auth/challenge",
      }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(400);

    expect(res.body.title).toBe("CHALLENGE_INVALID");
    // Nothing should land in either Firestore collection on rejection —
    // a missing challenge means we never trusted the attestation at all.
    expect(store["webauthn_credentials"]?.[validBody.credentialId]).toBeUndefined();
  });

  it("PFL-095: rejects with 400 CHALLENGE_EXPIRED when the challenge record is past its TTL", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-exp", companyId: "co", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
      consumeRegistrationChallenge: stubConsumeChallenge({
        ok:     false,
        code:   "CHALLENGE_EXPIRED",
        detail: "Challenge expired — request a new one via POST /v1/auth/challenge",
      }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(400);

    expect(res.body.title).toBe("CHALLENGE_EXPIRED");
    expect(store["webauthn_credentials"]?.[validBody.credentialId]).toBeUndefined();
  });

  it("PFL-095: rejects with 400 CHALLENGE_INVALID when clientDataJSON has no parseable challenge", async () => {
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-junk-cdj", companyId: "co", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    const res = await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ ...validBody, clientDataJSON: "not-base64url-or-json-garbage" })
      .expect(400);

    expect(res.body.title).toBe("CHALLENGE_INVALID");
    expect(res.body.detail).toMatch(/clientDataJSON/);
  });

  it("PFL-095: passes the challenge from clientDataJSON to the consumer for lookup", async () => {
    const seen: Array<{ challenge: string; userId: string }> = [];
    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-trace", companyId: "co-trace", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
      consumeRegistrationChallenge: async (input) => {
        seen.push(input);
        return {
          ok:     true,
          record: {
            challengeId: "ch-1",
            challenge:   input.challenge,
            userId:      input.userId,
            companyId:   "co-trace",
            purpose:     "registration",
            createdAt:   Date.now(),
            expiresAt:   Date.now() + 60_000,
          },
        };
      },
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(validBody)
      .expect(200);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.challenge).toBe(TEST_CHALLENGE_B64URL);
    expect(seen[0]?.userId).toBe("user-trace");
  });

  // ── PFL-085: multi-device — deviceName on the DeviceRecord ────────────────

  it("PFL-085: persists deviceName onto the DeviceRecord (not just the webauthn_credentials doc)", async () => {
    store["users"] = {
      "user-named": {
        userId:    "user-named",
        companyId: "co-named",
        devices:   [],
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-named", companyId: "co-named", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ ...validBody, deviceName: "MacBook Pro" })
      .expect(200);

    const userDoc = store["users"]!["user-named"] as Record<string, unknown>;
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(1);
    expect(devices[0]?.["deviceName"]).toBe("MacBook Pro");
    // lastUsedAt is stamped by sign-finalize, not by register — registration
    // should leave it absent.
    expect(devices[0]?.["lastUsedAt"]).toBeUndefined();
  });

  it("PFL-085: second device gets its own deviceName; first device's name is preserved", async () => {
    const firstDevice = {
      credentialId: "cred-first-iphone",
      publicKey:    "spki-first",
      enrolledAt:   NOW_SEC * 1000 - 86_400_000,
      deviceName:   "iPhone",
    };
    store["users"] = {
      "user-two": {
        userId:    "user-two",
        companyId: "co-two",
        devices:   [firstDevice],
      },
    };

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-two", companyId: "co-two", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send({ ...validBody, credentialId: "cred-second-macbook", deviceName: "MacBook Air" })
      .expect(200);

    const userDoc = store["users"]!["user-two"] as Record<string, unknown>;
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(2);
    expect(devices[0]?.["deviceName"]).toBe("iPhone");      // untouched
    expect(devices[1]?.["deviceName"]).toBe("MacBook Air");
  });

  it("PFL-085: omits deviceName when the client didn't send one (no `undefined` written to Firestore)", async () => {
    store["users"] = {
      "user-nameless": {
        userId:    "user-nameless",
        companyId: "co-nameless",
        devices:   [],
      },
    };

    const { deviceName: _unused, ...bodyWithoutName } = validBody;
    void _unused;

    const app = buildApp({
      verifyAuthBearer: () => ({
        userId: "user-nameless", companyId: "co-nameless", extInstallId: "e",
        iat: NOW_SEC, exp: NOW_SEC + 3600,
      }),
    });

    await request(app)
      .post("/v1/extension/register-credential")
      .set("Authorization", "Bearer x")
      .send(bodyWithoutName)
      .expect(200);

    const devices = (store["users"]!["user-nameless"] as Record<string, unknown>)["devices"] as Array<Record<string, unknown>>;
    expect(devices[0]).not.toHaveProperty("deviceName");   // omitted, not undefined
  });
});
