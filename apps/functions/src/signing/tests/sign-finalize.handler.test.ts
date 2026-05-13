/**
 * @file sign-finalize.handler.test.ts
 * @module apps/functions/src/signing/tests
 *
 * End-to-end regression test for /v1/sign → /v1/sign/finalize.
 *
 * The bug this test guards against: prior to this PR, sign.handler.ts did
 * not persist `payload` in pending_challenges, but sign-finalize.handler.ts
 * read it (via an `as EmailPayload` cast over an optional field). The cast
 * silenced TypeScript; production crashed inside validatePolicy with
 * "Cannot read properties of undefined (reading 'isWireInstruction')".
 *
 * This test issues a real /v1/sign request, captures the challengeId, and
 * runs /v1/sign/finalize against the same in-memory Firestore. It asserts
 * 200 + that envelope.payload deep-equals the originally signed payload.
 *
 * Stubs (documented inline):
 *   - firebase-admin/firestore: in-memory KV with transaction support.
 *   - @proofline/webauthn: assertion verifier returns true (no real ECDSA
 *     ceremony — the regression is independent of crypto).
 *   - makeStubPolicyContext from production wiring: approves valid bodies
 *     with permissive user/policy fixtures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock (supports runTransaction) ──────────────────────

interface DocRef {
  __col: string;
  __id:  string;
}

const store: Record<string, Record<string, unknown>> = {};

function ensureCol(col: string): Record<string, unknown> {
  if (!store[col]) store[col] = {};
  return store[col];
}

// PFL-094-followup: real Firestore (validateUserInput) refuses any
// `undefined` value at any depth on WriteBatch.set / Transaction.set —
// the prior stub silently accepted them, masking the bug that took down
// the live demo. Mirror the real strictness here so a future regression
// of the same shape fails CI instead of prod.
function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) {
    throw new Error(
      `Cannot use "undefined" as a Firestore value (found in field "${path}").`,
    );
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}.\`${i}\``));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoUndefined(v, path ? `${path}.${k}` : k);
    }
  }
}

function makeFirestoreMock() {
  const db = {
    collection(col: string) {
      return {
        doc(id: string) {
          const ref: DocRef = { __col: col, __id: id };
          return {
            __col: col,
            __id:  id,
            async get() {
              return {
                exists: Boolean(store[col]?.[id]),
                id,
                data: () => store[col]?.[id] ?? null,
              };
            },
            async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
              assertNoUndefined(data, `${col}/${id}`);
              const c = ensureCol(col);
              if (opts?.merge) {
                c[id] = { ...(c[id] as object ?? {}), ...data };
              } else {
                c[id] = data;
              }
            },
            // Used internally to identify the ref shape inside transactions
            _isRef: true as const,
            _ref:   ref,
          };
        },
        async add(data: Record<string, unknown>) {
          const c  = ensureCol(col);
          const id = `auto_${Object.keys(c).length + 1}`;
          c[id] = data;
          return { id };
        },
      };
    },
    async runTransaction<T>(fn: (tx: {
      get:    (ref: { __col: string; __id: string }) => Promise<{ exists: boolean; data: () => unknown }>;
      set:    (ref: { __col: string; __id: string }, data: Record<string, unknown>) => void;
      update: (ref: { __col: string; __id: string }, patch: Record<string, unknown>) => void;
      delete: (ref: { __col: string; __id: string }) => void;
    }) => Promise<T>): Promise<T> {
      const tx = {
        async get(ref: { __col: string; __id: string }) {
          const data = store[ref.__col]?.[ref.__id];
          return { exists: Boolean(data), data: () => data ?? null };
        },
        set(ref: { __col: string; __id: string }, data: Record<string, unknown>) {
          assertNoUndefined(data, `${ref.__col}/${ref.__id}`);
          ensureCol(ref.__col)[ref.__id] = data;
        },
        update(ref: { __col: string; __id: string }, patch: Record<string, unknown>) {
          assertNoUndefined(patch, `${ref.__col}/${ref.__id}`);
          const current = (store[ref.__col]?.[ref.__id] as Record<string, unknown>) ?? {};
          ensureCol(ref.__col)[ref.__id] = { ...current, ...patch };
        },
        delete(ref: { __col: string; __id: string }) {
          if (store[ref.__col]) delete store[ref.__col][ref.__id];
        },
      };
      return fn(tx);
    },
  };
  return db;
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => makeFirestoreMock(),
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps:       vi.fn(() => [{ name: "[DEFAULT]" }]),
  getApp:        vi.fn(),
}));

// PFL-081 fixed signing.helpers.ts to use static imports of finishAssertion
// (from @proofline/webauthn) and makeJoseSigner/makeJoseVerifier (from
// @proofline/sessions). The helpers themselves are no longer stubbed —
// instead we mock the LEAF packages so the helper's real call paths run and
// any future regression to the wiring will fail this test.
vi.mock("@proofline/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@proofline/webauthn")>("@proofline/webauthn");
  return {
    ...actual,
    finishAssertion: vi.fn(async () => ({ ok: true, signCount: 1, credentialId: "cred-test-001" })),
  };
});

vi.mock("@proofline/sessions", async () => {
  const actual = await vi.importActual<typeof import("@proofline/sessions")>("@proofline/sessions");
  return {
    ...actual,
    makeJoseSigner: vi.fn(() => ({ sign: vi.fn(async () => "stub-session-token") })),
    makeJoseVerifier: vi.fn(() => ({
      verify: vi.fn(async () => ({
        ok:    true,
        value: {
          v:                1,
          sessionId:        "stub-session-id",
          userId:           "dev-user",
          companyId:        "dev-company",
          recipientSetHash: "stub-recipient-scope",
          iat:              0,
          exp:              Math.floor(Date.now() / 1000) + 60,
        },
      })),
    })),
  };
});

// ─── Imports under test (after vi.mock hoisting) ─────────────────────────────

import { makeSignHandler } from "../handlers/sign.handler.js";
import { makeSignFinalizeHandler } from "../handlers/sign-finalize.handler.js";
import { makeStubPolicyContext } from "../../wiring/stubs.js";
import type { EmailPayload } from "@proofline/types";
import { finishAssertion } from "@proofline/webauthn";
import { makeJoseSigner } from "@proofline/sessions";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const CREDENTIAL_ID = "cred-test-001";
const RECIPIENT_SET_HASH = "a".repeat(64);

function makePayload(overrides: Partial<EmailPayload> = {}): EmailPayload {
  return {
    v: 1,
    from: "sarah@acme-title.com",
    to: ["mark@scotiabank.com"],
    cc: [],
    bcc: [],
    subject: "Closing documents for 123 Elm",
    body: "Please find the documents attached.",
    isWireInstruction: false,
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + 24 * 60 * 60 * 1000,
    nonce: "y8f3k2m9p1q7r5s6t0v4w8x2",
    companyId: "dev-company",
    ...overrides,
  };
}

function attachUser(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  (req as express.Request & { user: { userId: string; companyId: string } }).user = {
    userId:    "dev-user",
    companyId: "dev-company",
  };
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUser);

  // Mirror index.ts withPerRequestPolicyCtx: per-request stub PolicyContext
  // sourced from the request body's credentialId.
  app.post("/v1/sign", async (req, res, next) => {
    const credentialId = typeof req.body?.credentialId === "string" ? req.body.credentialId : "stub";
    const ctx = makeStubPolicyContext({ credentialId, userId: "dev-user", companyId: "dev-company" });
    try { await makeSignHandler(ctx)(req, res); } catch (e) { next(e); }
  });
  app.post("/v1/sign/finalize", async (req, res, next) => {
    const ctx = makeStubPolicyContext({ credentialId: CREDENTIAL_ID, userId: "dev-user", companyId: "dev-company" });
    try { await makeSignFinalizeHandler(ctx)(req, res); } catch (e) { next(e); }
  });

  // Surface handler errors as JSON so test failures show the real cause.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[test] handler error:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/sign → /v1/sign/finalize", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("round-trips the canonical payload through pending_challenges", async () => {
    const app = buildApp();
    const payload = makePayload();

    // Step 1 — issue challenge.
    const signRes = await request(app).post("/v1/sign").send({
      payload,
      recipientSetHash: RECIPIENT_SET_HASH,
      credentialId:     CREDENTIAL_ID,
      freshBiometric:   true,
    });

    expect(signRes.status).toBe(200);
    expect(signRes.body.ok).toBe(true);
    expect(signRes.body.policyDecision).toBe("APPROVED");
    const challengeId: string = signRes.body.challengeId;
    expect(typeof challengeId).toBe("string");
    expect(challengeId.length).toBeGreaterThan(0);

    // Confirm the write side now persists `payload` (the regression).
    const pending = store["pending_challenges"]?.[challengeId] as { payload?: EmailPayload } | undefined;
    expect(pending).toBeDefined();
    expect(pending?.payload).toEqual(payload);

    // Step 2 — finalize against the same in-memory store.
    const payloadHash: string = signRes.body.challenge.challenge
      ? // payloadHash is the hex sha256 of canonical bytes; recompute the same
        // way the handlers do so we don't reach into private helpers.
        await (async () => {
          const { canonicalize } = await import("@proofline/canonical");
          const crypto = await import("node:crypto");
          return crypto.createHash("sha256").update(canonicalize(payload)).digest("hex");
        })()
      : "";

    const finalizeRes = await request(app)
      .post("/v1/sign/finalize")
      .set("x-proofline-challenge-id", challengeId)
      .send({
        assertion: {
          credentialId:      CREDENTIAL_ID,
          clientDataJSON:    "stub-client-data",
          authenticatorData: "stub-auth-data",
          signature:         "stub-signature",
        },
        payloadHash,
        recipientSetHash: RECIPIENT_SET_HASH,
        path:             "fresh",
      });

    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.ok).toBe(true);
    expect(finalizeRes.body.envelope).toBeDefined();
    expect(finalizeRes.body.envelope.payload).toEqual(payload);
    expect(finalizeRes.body.envelope.status).toBe("SIGNED");
    expect(typeof finalizeRes.body.banner).toBe("string");

    // The pending challenge MUST be consumed after a successful finalize.
    expect(store["pending_challenges"]?.[challengeId]).toBeUndefined();
  });

  it("returns 410 CHALLENGE_CORRUPT when a pending record has no payload (legacy/defensive)", async () => {
    const app = buildApp();
    const payload = makePayload();

    const { canonicalize } = await import("@proofline/canonical");
    const crypto = await import("node:crypto");
    const canonicalBytes = canonicalize(payload);
    const payloadHash    = crypto.createHash("sha256").update(canonicalBytes).digest("hex");

    // Seed a pending_challenges record WITHOUT a payload to simulate a legacy
    // in-flight doc from before this fix. The defensive guard must short-circuit
    // before validatePolicy touches `.isWireInstruction`.
    const challengeId = "legacy-no-payload-challenge";
    ensureCol("pending_challenges")[challengeId] = {
      challengeId,
      payloadHash,
      recipientSetHash: RECIPIENT_SET_HASH,
      credentialId:     CREDENTIAL_ID,
      userId:           "dev-user",
      companyId:        "dev-company",
      path:             "fresh",
      expiresAt:        Date.now() + 60_000,
      // payload: intentionally omitted
    };

    const res = await request(app)
      .post("/v1/sign/finalize")
      .set("x-proofline-challenge-id", challengeId)
      .send({
        assertion: {
          credentialId:      CREDENTIAL_ID,
          clientDataJSON:    "stub-client-data",
          authenticatorData: "stub-auth-data",
          signature:         "stub-signature",
        },
        payloadHash,
        recipientSetHash: RECIPIENT_SET_HASH,
        path:             "fresh",
      });

    expect(res.status).toBe(410);
    expect(res.body.title).toBe("CHALLENGE_CORRUPT");
  });

  // Guards against the PFL-081 regression: signing.helpers.ts used to wire
  // @proofline/{webauthn,sessions} via dynamic require() under names that
  // didn't exist, so the call sites threw `TypeError: ... is not a function`
  // in prod. The earlier round-trip test would pass even with that bug
  // because it mocked the helpers module itself. This test mocks ONLY the
  // leaf packages — if the helper's static-import wiring breaks again, the
  // call counts below drop to 0 and the test fails.
  it("invokes finishAssertion + makeJoseSigner through the real helper code (PFL-081 wiring guard)", async () => {
    const finishAssertionMock = vi.mocked(finishAssertion);
    const makeJoseSignerMock   = vi.mocked(makeJoseSigner);
    finishAssertionMock.mockClear();
    makeJoseSignerMock.mockClear();

    const app = buildApp();
    const payload = makePayload();

    const signRes = await request(app).post("/v1/sign").send({
      payload,
      recipientSetHash: RECIPIENT_SET_HASH,
      credentialId:     CREDENTIAL_ID,
      freshBiometric:   true,
    });
    expect(signRes.status).toBe(200);

    const { canonicalize } = await import("@proofline/canonical");
    const nodeCrypto = await import("node:crypto");
    const payloadHash = nodeCrypto.createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex");

    const finalizeRes = await request(app)
      .post("/v1/sign/finalize")
      .set("x-proofline-challenge-id", signRes.body.challengeId)
      .send({
        assertion: {
          credentialId:      CREDENTIAL_ID,
          clientDataJSON:    "stub-client-data",
          authenticatorData: "stub-auth-data",
          signature:         "stub-signature",
        },
        payloadHash,
        recipientSetHash: RECIPIENT_SET_HASH,
        path:             "fresh",
      });

    expect(finalizeRes.status).toBe(200);
    expect(finishAssertionMock).toHaveBeenCalledTimes(1);
    expect(makeJoseSignerMock).toHaveBeenCalledTimes(1);

    // Sanity: the call site passed real arguments derived from the request.
    const finishArg = finishAssertionMock.mock.calls[0]![0];
    expect(finishArg.expectedRPID).toBe("proofline-sign.web.app");
    expect(finishArg.expectedOrigin).toBe("https://proofline-sign.web.app");
    expect(typeof finishArg.storedPublicKey).toBe("string");
  });

  // PFL-094-followup regression guards. Prior to the fix, the fresh path
  // wrote `sessionId: parsedSessionToken?.sessionId` — i.e. literal
  // `undefined` — into the persisted envelope, which real Firestore
  // rejects in WriteBatch.set with `validateUserInput`. The in-memory
  // Firestore stub above now mirrors that strictness via
  // `assertNoUndefined`, so the bug shape will fail CI in future too.

  it("PFL-094-followup: fresh sign omits sessionId from the persisted signature (no undefined into Firestore)", async () => {
    const app = buildApp();
    const payload = makePayload();

    const signRes = await request(app).post("/v1/sign").send({
      payload,
      recipientSetHash: RECIPIENT_SET_HASH,
      credentialId:     CREDENTIAL_ID,
      freshBiometric:   true,
    });
    expect(signRes.status).toBe(200);

    const { canonicalize } = await import("@proofline/canonical");
    const nodeCrypto = await import("node:crypto");
    const payloadHash = nodeCrypto.createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex");

    const finalizeRes = await request(app)
      .post("/v1/sign/finalize")
      .set("x-proofline-challenge-id", signRes.body.challengeId)
      .send({
        assertion: {
          credentialId:      CREDENTIAL_ID,
          clientDataJSON:    "stub-client-data",
          authenticatorData: "stub-auth-data",
          signature:         "stub-signature",
        },
        payloadHash,
        recipientSetHash: RECIPIENT_SET_HASH,
        path:             "fresh",
      });

    // No 500 — the prior bug surfaced exactly here.
    expect(finalizeRes.status).toBe(200);

    // Find the persisted envelope (the handler picks a uuidv7 ID so we
    // scan the collection instead of guessing). Exactly one expected.
    const envelopes = Object.values(store["signed_messages"] ?? {}) as Array<{
      signatures: Array<Record<string, unknown>>;
    }>;
    expect(envelopes).toHaveLength(1);
    const sig = envelopes[0]!.signatures[0]!;

    // The key must be ABSENT (not `null`, not `undefined`-as-property).
    expect(Object.prototype.hasOwnProperty.call(sig, "sessionId")).toBe(false);
    // Sanity: the other signature fields are present.
    expect(sig).toMatchObject({
      signerId:     "dev-user",
      credentialId: CREDENTIAL_ID,
      signedAt:     expect.any(Number),
      path:         "fresh",
    });
    expect(typeof sig["sig"]).toBe("string");

    // The response envelope mirrors the persisted shape — no sessionId key.
    const responseSig = finalizeRes.body.envelope.signatures[0];
    expect(Object.prototype.hasOwnProperty.call(responseSig, "sessionId")).toBe(false);
  });

  it("PFL-094-followup: silent sign attaches sessionId from the verified token", async () => {
    const payload = makePayload();

    // ── Step 1 — issue the challenge via /v1/sign on the standard buildApp ──
    const signApp = buildApp();
    const signRes = await request(signApp).post("/v1/sign").send({
      payload,
      recipientSetHash: RECIPIENT_SET_HASH,
      credentialId:     CREDENTIAL_ID,
      freshBiometric:   true,
    });
    expect(signRes.status).toBe(200);
    const challengeId: string = signRes.body.challengeId;

    // Flip the persisted pending challenge from "fresh" to "silent" so
    // the finalize handler takes the session-token branch. Easier than
    // wiring sign-silent end-to-end just for this assertion.
    const pending = store["pending_challenges"]![challengeId] as Record<string, unknown>;
    pending["path"] = "silent";

    // ── Step 2 — build a finalize-only app whose PolicyContext returns ──
    // a real session for "stub-session-id" (the value the jose-verifier
    // mock yields). makeStubPolicyContext otherwise returns null from
    // getSession, which validatePolicy treats as SESSION_INVALID → 401.
    const finalizeApp = express();
    finalizeApp.use(express.json());
    finalizeApp.use(attachUser);
    finalizeApp.post("/v1/sign/finalize", async (req, res, next) => {
      const baseCtx = makeStubPolicyContext({
        credentialId: CREDENTIAL_ID,
        userId:       "dev-user",
        companyId:    "dev-company",
      });
      const ctx = {
        ...baseCtx,
        async getSession(_sessionId: string) {
          const now = baseCtx.now();
          return {
            sessionId:           "stub-session-id",
            userId:              "dev-user",
            companyId:           "dev-company",
            recipientSetHash:    RECIPIENT_SET_HASH,
            recipientAddresses:  payload.to,
            authorizedAt:        now - 60_000,
            expiresAt:           now + 10 * 60 * 1000,
            hardCapAt:           now + 60 * 60 * 1000,
            deviceCredentialId:  CREDENTIAL_ID,
            status:              "active" as const,
            lastUsedAt:          now - 30_000,
            signCount:           1,
          };
        },
      };
      try { await makeSignFinalizeHandler(ctx)(req, res); } catch (e) { next(e); }
    });
    finalizeApp.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // eslint-disable-next-line no-console
      console.error("[test] handler error:", err);
      res.status(500).json({ error: err.message, stack: err.stack });
    });

    const { canonicalize } = await import("@proofline/canonical");
    const nodeCrypto = await import("node:crypto");
    const payloadHash = nodeCrypto.createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex");

    const finalizeRes = await request(finalizeApp)
      .post("/v1/sign/finalize")
      .set("x-proofline-challenge-id", challengeId)
      .send({
        assertion: {
          credentialId:      CREDENTIAL_ID,
          clientDataJSON:    "stub-client-data",
          authenticatorData: "stub-auth-data",
          signature:         "stub-signature",
        },
        // The jose-verifier mock at the top of this file resolves to a
        // payload whose sessionId is "stub-session-id" — that's the value
        // we expect to see attached to the signature record.
        sessionToken:     "stub-jws.payload.sig",
        payloadHash,
        recipientSetHash: RECIPIENT_SET_HASH,
        path:             "silent",
      });

    expect(finalizeRes.status).toBe(200);

    const envelopes = Object.values(store["signed_messages"] ?? {}) as Array<{
      signatures: Array<Record<string, unknown>>;
    }>;
    expect(envelopes).toHaveLength(1);
    const sig = envelopes[0]!.signatures[0]!;
    expect(sig["sessionId"]).toBe("stub-session-id");
    expect(sig["path"]).toBe("silent");
  });
});
