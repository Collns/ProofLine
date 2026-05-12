/**
 * @file cosign.test.ts
 * @module apps/functions/src/cosign/__tests__
 *
 * PFL-062 — Contract tests for the three /v1/cosign/* handlers.
 *
 * Strategy: in-memory Firestore mock (same shape used by onboarding e2e
 * + extension-auth tests). FieldValue.arrayUnion is shimmed to do an
 * in-place push so the cosigner-append logic is observable in `store`.
 *
 * The shape `signed_messages/{id}` stores the local EmailSignedEnvelope
 * format that sign-finalize writes. Tests seed envelopes in that shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock ────────────────────────────────────────────────

const store: Record<string, Record<string, unknown>> = {};

// Sentinel that the mock recognizes as "treat the value as an arrayUnion op".
const ARRAY_UNION_SENTINEL = Symbol.for("test.arrayUnion");

interface ArrayUnionOp {
  __op: typeof ARRAY_UNION_SENTINEL;
  values: unknown[];
}

function isArrayUnionOp(v: unknown): v is ArrayUnionOp {
  return Boolean(v) && typeof v === "object" && (v as ArrayUnionOp).__op === ARRAY_UNION_SENTINEL;
}

function applyArrayUnions(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isArrayUnionOp(v)) {
      const current = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
      out[k] = [...current, ...v.values];
    } else {
      out[k] = v;
    }
  }
  return out;
}

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
          const existing = (store[col][id] as Record<string, unknown>) ?? {};
          if (opts?.merge) {
            store[col][id] = applyArrayUnions(existing, data);
          } else {
            store[col][id] = applyArrayUnions({}, data);
          }
        },
        update: async (patch: Record<string, unknown>) => {
          if (!store[col]?.[id]) throw new Error(`Doc ${col}/${id} not found`);
          store[col][id] = applyArrayUnions(store[col][id] as Record<string, unknown>, patch);
        },
        delete: async () => {
          if (store[col]) delete store[col][id];
        },
      }),
      add: async (data: Record<string, unknown>) => {
        store[col] = store[col] ?? {};
        const id = `auto_${Object.keys(store[col]).length + 1}`;
        store[col][id] = data;
        return { id };
      },
    }),
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => makeFirestoreMock(),
  FieldValue: {
    arrayUnion: (...values: unknown[]): ArrayUnionOp => ({
      __op: ARRAY_UNION_SENTINEL,
      values,
    }),
  },
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps:       vi.fn(() => [{ name: "[DEFAULT]" }]),
  getApp:        vi.fn(),
}));

// @proofline/webauthn is wired via require() inside the finalize handler.
// Stub it so tests don't pull a real WebAuthn verifier — they exercise the
// "credential not indexed → soft failure" branch by default.
vi.mock("@proofline/webauthn", () => ({
  verifyAssertion: vi.fn(async () => true),
}));

import { makeCosignRouter } from "../router.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function makeJws(claims: Record<string, unknown>): string {
  const header  = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.SIGNATURE_PLACEHOLDER`;
}

function buildApp(deps?: Parameters<typeof makeCosignRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use("/v1/cosign", makeCosignRouter(deps));
  return app;
}

const NOW_SEC = Math.floor(Date.now() / 1000);
const FUTURE_EXP = NOW_SEC + 60 * 25;
const PAST_EXP   = NOW_SEC - 60;

const WIRE_PAYLOAD = {
  v: 1,
  amount: 40000000,
  currency: "USD",
  recipientAccount: "••••7842",
  recipientRouting: "026005092",
  memo: "Escrow disbursement",
  reference: "REF-2026-05-12-WIRE",
};

const STORED_HASH = "abc123hash".padEnd(64, "0");

function seedEnvelope(messageId: string, overrides: Record<string, unknown> = {}): void {
  store["signed_messages"] = store["signed_messages"] ?? {};
  store["signed_messages"][messageId] = {
    envelopeId: messageId,
    payload:    WIRE_PAYLOAD,
    payloadHash: STORED_HASH,
    status:     "SIGNED",
    createdAt:  Date.now(),
    signatures: [
      {
        signerId:     "user-sarah",
        credentialId: "cred-sarah-001",
        sig:          "MEQ...",
        signedAt:     NOW_SEC - 90,
        sessionId:    "sess-1",
        path:         "fresh",
      },
    ],
    ...overrides,
  };
}

function seedSignerProfile(): void {
  store["users"] = store["users"] ?? {};
  store["users"]["user-sarah"] = {
    displayName: "Sarah Chen",
    companyId:   "acme-title",
  };
  store["companies"] = store["companies"] ?? {};
  store["companies"]["acme-title"] = {
    domain:    "acme-title.com",
    legalName: "Acme Title LLC",
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── GET /v1/cosign/:messageId ──────────────────────────────────────────────

describe("GET /v1/cosign/:messageId", () => {
  it("happy path: returns envelope + signer + cosign challenge", async () => {
    const messageId = "msg-happy-1";
    seedEnvelope(messageId);
    seedSignerProfile();

    const token = makeJws({
      iss: "acme-title",
      sub: messageId,
      payloadHash: STORED_HASH,
      iat: NOW_SEC - 10,
      exp: FUTURE_EXP,
    });

    const app = buildApp();
    const res = await request(app)
      .get(`/v1/cosign/${messageId}`)
      .query({ token })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.messageId).toBe(messageId);
    expect(res.body.payloadHash).toBe(STORED_HASH);
    expect(res.body.payloadType).toBe("wire");
    expect(res.body.expiresAt).toBe(FUTURE_EXP);
    expect(typeof res.body.cosignChallenge).toBe("string");
    expect(res.body.cosignChallenge.length).toBeGreaterThan(20);
    expect(res.body.signer).toMatchObject({
      userId:           "user-sarah",
      credentialId:     "cred-sarah-001",
      userDisplayName:  "Sarah Chen",
      companyId:        "acme-title",
      companyDomain:    "acme-title.com",
      companyLegalName: "Acme Title LLC",
    });
    // Envelope is shaped to the canonical SignedEnvelope schema.
    expect(res.body.envelope.v).toBe(1);
    expect(res.body.envelope.signers).toHaveLength(1);
    expect(res.body.envelope.signers[0].userId).toBe("user-sarah");

    // Challenge persisted for finalize.
    expect(store["cosign_challenges"]?.[messageId]).toBeDefined();
  });

  it("returns NOT_FOUND when the message doesn't exist", async () => {
    const token = makeJws({
      iss: "acme-title",
      sub: "msg-nope",
      payloadHash: STORED_HASH,
      iat: NOW_SEC - 10,
      exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .get("/v1/cosign/msg-nope")
      .query({ token })
      .expect(200);

    expect(res.body).toEqual({
      ok: false,
      code: "NOT_FOUND",
      detail: expect.stringContaining("msg-nope"),
    });
  });

  it("returns ALREADY_COSIGNED when the envelope already has > 1 signer", async () => {
    const messageId = "msg-already";
    seedEnvelope(messageId, {
      signatures: [
        { signerId: "user-sarah", credentialId: "cred-a", sig: "s1", signedAt: NOW_SEC - 90, path: "fresh" },
        { signerId: "user-mike",  credentialId: "cred-b", sig: "s2", signedAt: NOW_SEC - 30, path: "fresh" },
      ],
    });

    const token = makeJws({
      iss: "acme-title",
      sub: messageId,
      payloadHash: STORED_HASH,
      iat: NOW_SEC - 10,
      exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .get(`/v1/cosign/${messageId}`)
      .query({ token })
      .expect(200);

    expect(res.body).toEqual({
      ok: false,
      code: "ALREADY_COSIGNED",
      detail: expect.any(String),
    });
  });

  it("returns COSIGN_LINK_EXPIRED when JWS exp is in the past", async () => {
    seedEnvelope("msg-expired");
    const token = makeJws({
      iss: "acme-title",
      sub: "msg-expired",
      payloadHash: STORED_HASH,
      iat: NOW_SEC - 3600,
      exp: PAST_EXP,
    });

    const res = await request(buildApp())
      .get("/v1/cosign/msg-expired")
      .query({ token })
      .expect(200);

    expect(res.body).toEqual({
      ok: false,
      code: "COSIGN_LINK_EXPIRED",
      detail: expect.any(String),
    });
  });

  it("returns COSIGN_LINK_INVALID when the token's `sub` mismatches the URL", async () => {
    seedEnvelope("msg-mismatch");
    const token = makeJws({
      iss: "acme-title",
      sub: "msg-different",
      payloadHash: STORED_HASH,
      iat: NOW_SEC - 10,
      exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .get("/v1/cosign/msg-mismatch")
      .query({ token })
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("COSIGN_LINK_INVALID");
  });
});

// ─── POST /v1/cosign/:messageId/finalize ────────────────────────────────────

describe("POST /v1/cosign/:messageId/finalize", () => {
  it("happy path: appends cosigner, queues anchor, returns anchorWillFollow", async () => {
    const messageId = "msg-finalize-happy";
    seedEnvelope(messageId);
    seedSignerProfile();

    // Pre-seed a context challenge (handler consumes it).
    store["cosign_challenges"] = {
      [messageId]: {
        messageId,
        challenge:   "challenge-bytes-abc",
        payloadHash: STORED_HASH,
        iss:         "acme-title",
        issuedAt:    NOW_SEC - 30,
        expiresAt:   NOW_SEC + 300,
      },
    };

    const token = makeJws({
      iss: "acme-title", sub: messageId, payloadHash: STORED_HASH,
      iat: NOW_SEC - 10, exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .post(`/v1/cosign/${messageId}/finalize`)
      .set("X-ProofLine-Cosign-Token", token)
      .send({
        challenge: "challenge-bytes-abc",
        assertion: {
          id:        "cosigner-cred-001",
          response:  { signature: "MEQ-cosigner-sig" },
        },
      })
      .expect(200);

    expect(res.body).toEqual({
      ok:               true,
      messageId,
      anchorWillFollow: true,
    });

    // Cosigner appended to the envelope.
    const updated = store["signed_messages"]?.[messageId] as Record<string, unknown>;
    expect(updated["status"]).toBe("COSIGNED");
    const signers = updated["signers"] as Array<Record<string, unknown>>;
    expect(signers.length).toBe(1);
    expect(signers[0]?.role).toBe("cosigner");

    // Challenge consumed.
    expect(store["cosign_challenges"]?.[messageId]).toBeUndefined();

    // Anchor queue row written.
    expect(Object.keys(store["anchor_queue"] ?? {}).length).toBe(1);
  });

  it("returns ASSERTION_INVALID when the body challenge doesn't match the stored one", async () => {
    const messageId = "msg-bad-challenge";
    seedEnvelope(messageId);
    store["cosign_challenges"] = {
      [messageId]: {
        messageId,
        challenge:   "stored-challenge",
        payloadHash: STORED_HASH,
        expiresAt:   NOW_SEC + 300,
      },
    };

    const token = makeJws({
      iss: "acme-title", sub: messageId, payloadHash: STORED_HASH,
      iat: NOW_SEC - 10, exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .post(`/v1/cosign/${messageId}/finalize`)
      .set("X-ProofLine-Cosign-Token", token)
      .send({ challenge: "wrong-challenge", assertion: {} })
      .expect(400);

    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("ASSERTION_INVALID");
  });

  it("returns COSIGN_LINK_INVALID when the cosign token header is missing", async () => {
    const messageId = "msg-no-header";
    seedEnvelope(messageId);

    const res = await request(buildApp())
      .post(`/v1/cosign/${messageId}/finalize`)
      .send({ challenge: "x", assertion: {} })
      .expect(401);

    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("COSIGN_LINK_INVALID");
  });

  it("returns COSIGN_LINK_INVALID when no challenge has been issued yet", async () => {
    const messageId = "msg-no-challenge";
    seedEnvelope(messageId);

    const token = makeJws({
      iss: "acme-title", sub: messageId, payloadHash: STORED_HASH,
      iat: NOW_SEC - 10, exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .post(`/v1/cosign/${messageId}/finalize`)
      .set("X-ProofLine-Cosign-Token", token)
      .send({ challenge: "anything", assertion: {} })
      .expect(400);

    expect(res.body.code).toBe("COSIGN_LINK_INVALID");
  });
});

// ─── POST /v1/cosign/:messageId/refresh ─────────────────────────────────────

describe("POST /v1/cosign/:messageId/refresh", () => {
  it("happy path: mints a fresh JWS and invokes the email sender", async () => {
    const messageId = "msg-refresh-happy";
    seedEnvelope(messageId, {
      payload: { ...WIRE_PAYLOAD, to: ["mike@cosigner.com"] },
    });

    const expiredToken = makeJws({
      iss: "acme-title", sub: messageId, payloadHash: STORED_HASH,
      iat: NOW_SEC - 3600, exp: PAST_EXP,
    });

    const sendFreshLinkEmail = vi.fn(async () => {});
    const app = buildApp({ refresh: { sendFreshLinkEmail } });

    const res = await request(app)
      .post(`/v1/cosign/${messageId}/refresh`)
      .send({ token: expiredToken })
      .expect(200);

    expect(res.body).toEqual({ ok: true, freshLinkSent: true });
    expect(sendFreshLinkEmail).toHaveBeenCalledTimes(1);
    const arg = sendFreshLinkEmail.mock.calls[0]![0] as {
      messageId: string; freshToken: string; expiresAt: number;
    };
    expect(arg.messageId).toBe(messageId);
    expect(arg.expiresAt).toBeGreaterThan(NOW_SEC);
    // Fresh token decodes to claims for the same messageId.
    const newClaims = JSON.parse(
      Buffer.from((arg.freshToken.split(".")[1]) as string, "base64url").toString("utf8"),
    );
    expect(newClaims.sub).toBe(messageId);
    expect(newClaims.exp).toBeGreaterThan(NOW_SEC);
  });

  it("returns ALREADY_COSIGNED if the envelope is already cosigned", async () => {
    const messageId = "msg-refresh-already";
    seedEnvelope(messageId, {
      signatures: [
        { signerId: "user-a", credentialId: "ca", sig: "s1", signedAt: NOW_SEC - 90, path: "fresh" },
        { signerId: "user-b", credentialId: "cb", sig: "s2", signedAt: NOW_SEC - 30, path: "fresh" },
      ],
    });

    const token = makeJws({
      iss: "acme-title", sub: messageId, payloadHash: STORED_HASH,
      iat: NOW_SEC - 10, exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .post(`/v1/cosign/${messageId}/refresh`)
      .send({ token })
      .expect(200);

    expect(res.body).toEqual({
      ok:     false,
      code:   "ALREADY_COSIGNED",
      detail: expect.any(String),
    });
  });

  it("returns NOT_FOUND when the messageId has no envelope", async () => {
    const token = makeJws({
      iss: "acme-title", sub: "msg-ghost", payloadHash: STORED_HASH,
      iat: NOW_SEC - 10, exp: FUTURE_EXP,
    });

    const res = await request(buildApp())
      .post("/v1/cosign/msg-ghost/refresh")
      .send({ token })
      .expect(404);

    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns COSIGN_LINK_INVALID when the body is missing token", async () => {
    seedEnvelope("msg-x");
    const res = await request(buildApp())
      .post("/v1/cosign/msg-x/refresh")
      .send({})
      .expect(400);

    expect(res.body.code).toBe("COSIGN_LINK_INVALID");
  });
});
