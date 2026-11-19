/**
 * PFL-136 — cosign server path end to end:
 *
 *   /v1/sign (over the sender's limit) → COSIGN_REQUIRED + sender challenge
 *   /v1/sign/finalize → PENDING_COSIGN, approvers stored, link emailed
 *   GET  /v1/cosign/:id?token=… (link from the email) → context + challenge
 *   POST /v1/cosign/:id/finalize (approver passkey) → COSIGNED + anchor queued
 *   GET  /v1/sign/status/:id → COSIGNED
 *
 * In-memory Firestore with the query/transaction subset these handlers use.
 * WebAuthn verification is stubbed at the leaf (finishAssertion).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore ─────────────────────────────────────────────────────

const store: Record<string, Record<string, Record<string, unknown>>> = {};
const UNION = Symbol.for("test.arrayUnion");
type Union = { __op: typeof UNION; values: unknown[] };
const isUnion = (v: unknown): v is Union => Boolean(v) && typeof v === "object" && (v as Union).__op === UNION;

function col(name: string) {
  store[name] = store[name] ?? {};
  return store[name]!;
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isUnion(v) ? [...((out[k] as unknown[]) ?? []), ...v.values] : v;
  }
  return out;
}

function docRef(c: string, id: string) {
  return {
    __c: c, __id: id, id,
    async get() { const d = col(c)[id]; return { exists: Boolean(d), id, data: () => d }; },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      col(c)[id] = opts?.merge ? merge(col(c)[id] ?? {}, data) : merge({}, data);
    },
    async update(patch: Record<string, unknown>) { col(c)[id] = merge(col(c)[id] ?? {}, patch); },
    async delete() { delete col(c)[id]; },
  };
}

function query(c: string, filters: [string, string, unknown][], lim?: number) {
  return {
    where: (f: string, op: string, v: unknown) => query(c, [...filters, [f, op, v]], lim),
    limit: (n: number) => query(c, filters, n),
    async get() {
      let docs = Object.entries(col(c)).filter(([, d]) => filters.every(([f, op, v]) =>
        op === "in" ? (v as unknown[]).includes(d[f]) : d[f] === v));
      if (lim) docs = docs.slice(0, lim);
      return { empty: docs.length === 0, docs: docs.map(([id, d]) => ({ id, data: () => d, ref: docRef(c, id) })) };
    },
  };
}

const db = {
  collection: (c: string) => ({
    doc: (id: string) => docRef(c, id),
    where: (f: string, op: string, v: unknown) => query(c, [[f, op, v]]),
    async add(data: Record<string, unknown>) {
      const id = `auto_${Object.keys(col(c)).length + 1}`;
      col(c)[id] = data;
      return { id };
    },
  }),
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { col(ref.__c)[ref.__id] = data; },
      update: (ref: ReturnType<typeof docRef>, patch: Record<string, unknown>) => { col(ref.__c)[ref.__id] = merge(col(ref.__c)[ref.__id] ?? {}, patch); },
      delete: (ref: ReturnType<typeof docRef>) => { delete col(ref.__c)[ref.__id]; },
    });
  },
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => db,
  FieldValue: { arrayUnion: (...values: unknown[]) => ({ __op: Symbol.for("test.arrayUnion"), values }) },
}));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => [{}]), getApp: vi.fn() }));
vi.mock("@proofline/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@proofline/webauthn")>("@proofline/webauthn");
  return { ...actual, finishAssertion: vi.fn(async () => ({ ok: true, signCount: 1, credentialId: "c" })) };
});

import { canonicalize } from "@proofline/canonical";
import * as crypto from "node:crypto";
import type { EmailPayload } from "@proofline/types";

import { makeSignHandler } from "../../signing/handlers/sign.handler.js";
import { makeSignFinalizeHandler } from "../../signing/handlers/sign-finalize.handler.js";
import { makeSignStatusHandler } from "../../signing/handlers/sign-status.handler.js";
import { makeStubPolicyContext } from "../../wiring/stubs.js";
import { makeCosignRouter } from "../router.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const COMPANY = "acme-title";
const SENDER = "user-sarah";
const SENDER_CRED = "cred-sarah";
const APPROVER = "user-mike";
const APPROVER_CRED = "cred-mike";

function seedUsers(): void {
  col("users")[SENDER] = { companyId: COMPANY, role: "owner", status: "active", email: "sarah@acme-title.com" };
  col("users")[APPROVER] = {
    companyId: COMPANY, role: "manager", status: "active", email: "Mike@Acme-Title.com",
    devices: [{ credentialId: APPROVER_CRED, revokedAt: null }],
  };
  col("users")["user-ann"] = { companyId: COMPANY, role: "member", status: "active", email: "ann@acme-title.com" };
  col("users")["user-old"] = { companyId: COMPANY, role: "manager", status: "disabled", email: "old@acme-title.com" };
  col("webauthn_credentials")[APPROVER_CRED] = { userId: APPROVER, companyId: COMPANY, publicKey: "cose-mike" };
}

const wirePayload = (amount: number): EmailPayload => ({
  v: 1, from: "sarah@acme-title.com", to: ["mark@scotia.example"], cc: [], bcc: [],
  subject: "Wire for closing", body: "Please wire the closing funds.", isWireInstruction: true,
  wirePayload: { v: 1, amount, currency: "USD", recipientAccount: "XXXX7842", recipientRouting: "026005092" },
  issuedAt: 1_700_000_000_000, expiresAt: 1_700_000_000_000 + 86_400_000,
  nonce: `nonce-${amount}-abcdefghijklmnopqrstuv`, companyId: COMPANY,
});

const hashOf = (p: EmailPayload) => crypto.createHash("sha256").update(canonicalize(p)).digest("hex");

function buildApp(sendCosignRequest: (to: string[], wire: unknown, link: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const sender = express.Router();
  sender.use((req, _res, next) => { (req as express.Request & { user: unknown }).user = { userId: SENDER, companyId: COMPANY }; next(); });
  const ctx = () => makeStubPolicyContext({ credentialId: SENDER_CRED, userId: SENDER, companyId: COMPANY });
  sender.post("/", (req, res, next) => { makeSignHandler(ctx())(req, res).catch(next); });
  sender.post("/finalize", (req, res, next) => {
    makeSignFinalizeHandler(ctx(), { sendCosignRequest, signAppBaseUrl: "https://sign.test" })(req, res).catch(next);
  });
  sender.get("/status/:envelopeId", (req, res, next) => { makeSignStatusHandler()(req, res).catch(next); });
  app.use("/v1/sign", sender);
  app.use("/v1/cosign", makeCosignRouter());
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

async function senderSigns(app: express.Express, payload: EmailPayload) {
  const signRes = await request(app).post("/v1/sign").send({
    payload, recipientSetHash: "a".repeat(64), credentialId: SENDER_CRED, freshBiometric: true,
  });
  return signRes;
}

async function senderFinalizes(app: express.Express, payload: EmailPayload, challengeId: string) {
  return request(app)
    .post("/v1/sign/finalize")
    .set("x-proofline-challenge-id", challengeId)
    .send({
      assertion: { credentialId: SENDER_CRED, clientDataJSON: "cd", authenticatorData: "ad", signature: "sarah-sig" },
      payloadHash: hashOf(payload), recipientSetHash: "a".repeat(64), path: "fresh",
    });
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  seedUsers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cosign end to end (PFL-136)", () => {
  it("sender signs → approvers emailed → approver cosigns on the sign app → COSIGNED + anchored", async () => {
    const emails: { to: string[]; wire: unknown; link: string }[] = [];
    const app = buildApp(async (to, wire, link) => { emails.push({ to, wire, link }); });
    const payload = wirePayload(25_000_000); // over the stub user's 10M per-email limit

    // 1. Sender: COSIGN_REQUIRED still comes with the sender's own challenge.
    const signRes = await senderSigns(app, payload);
    expect(signRes.status).toBe(200);
    expect(signRes.body).toMatchObject({ ok: true, policyDecision: "COSIGN_REQUIRED", approvers: [APPROVER] });
    expect(signRes.body.challenge.challenge).toEqual(expect.any(String));

    // 2. Sender finalizes → PENDING_COSIGN, nothing anchored, approver emailed.
    const fin = await senderFinalizes(app, payload, signRes.body.challengeId);
    expect(fin.status).toBe(200);
    expect(fin.body.cosign).toMatchObject({ status: "PENDING_COSIGN", approverCount: 1, emailed: true });
    const envelopeId: string = fin.body.envelope.envelopeId;
    const stored = col("signed_messages")[envelopeId]!;
    expect(stored).toMatchObject({ status: "PENDING_COSIGN", cosign: { approverUserIds: [APPROVER], approverEmails: ["mike@acme-title.com"] } });
    expect(Object.keys(col("anchor_queue"))).toHaveLength(0);
    expect(Object.keys(col("sessions"))).toHaveLength(0);

    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toEqual(["mike@acme-title.com"]); // never the wire recipient
    expect(emails[0]!.wire).toMatchObject({ amount: 2_500_000_000, recipientAccountLast4: "7842" }); // cents
    const link = new URL(emails[0]!.link);
    expect(`${link.origin}${link.pathname}`).toBe(`https://sign.test/cosign/${envelopeId}`);
    const token = link.searchParams.get("t")!;

    const pending = await request(app).get(`/v1/sign/status/${envelopeId}`);
    expect(pending.body).toMatchObject({ status: "PENDING_COSIGN", signatureCount: 1, linkExpiresAt: expect.any(Number) });

    // 3. Approver opens the link: context + challenge for the exact payload.
    const ctxRes = await request(app).get(`/v1/cosign/${envelopeId}`).query({ token });
    expect(ctxRes.body).toMatchObject({ ok: true, payloadHash: hashOf(payload) });
    expect(ctxRes.body.payload).toEqual(payload);

    // 4. Approver approves with their passkey.
    const cos = await request(app)
      .post(`/v1/cosign/${envelopeId}/finalize`)
      .set("X-ProofLine-Cosign-Token", token)
      .send({
        challenge: ctxRes.body.cosignChallenge,
        assertion: { id: APPROVER_CRED, response: { clientDataJSON: "cd2", authenticatorData: "ad2", signature: "mike-sig" } },
      });
    expect(cos.status).toBe(200);
    expect(cos.body).toEqual({ ok: true, messageId: envelopeId, anchorWillFollow: true });

    const done = col("signed_messages")[envelopeId]!;
    expect(done["status"]).toBe("COSIGNED");
    expect((done["signatures"] as { userId?: string; signerId?: string }[]).map((s) => s.userId ?? s.signerId))
      .toEqual([SENDER, APPROVER]);
    expect(Object.values(col("anchor_queue"))).toEqual([expect.objectContaining({ envelopeId, source: "cosign-finalize" })]);

    const status = await request(app).get(`/v1/sign/status/${envelopeId}`);
    expect(status.body).toMatchObject({ status: "COSIGNED", signatureCount: 2 });

    // 5. The link can't be used again.
    const again = await request(app).get(`/v1/cosign/${envelopeId}`).query({ token });
    expect(again.body.code).toBe("ALREADY_COSIGNED");
  });

  it("refuses up front when nobody else can approve", async () => {
    delete col("users")[APPROVER];
    const app = buildApp(async () => {});
    const res = await senderSigns(app, wirePayload(25_000_000));
    expect(res.status).toBe(422);
    expect(res.body.title).toBe("NO_ELIGIBLE_COSIGNER");
  });

  it("wires under the limit are signed normally with no cosign request", async () => {
    const send = vi.fn(async () => {});
    const app = buildApp(send);
    const payload = wirePayload(5_000);
    const signRes = await senderSigns(app, payload);
    expect(signRes.body.policyDecision).toBe("APPROVED");
    const fin = await senderFinalizes(app, payload, signRes.body.challengeId);
    expect(fin.status).toBe(200);
    expect(fin.body.cosign).toBeUndefined();
    expect(col("signed_messages")[fin.body.envelope.envelopeId]!["status"]).toBe("SIGNED");
    expect(send).not.toHaveBeenCalled();

    // A plain signed message can't be pulled into the cosign flow.
    const { mintCosignLinkToken } = await import("../cosign-request.js");
    const { token } = mintCosignLinkToken({ companyId: COMPANY, messageId: fin.body.envelope.envelopeId, payloadHash: hashOf(payload), ttlSec: 600 });
    const ctxRes = await request(app).get(`/v1/cosign/${fin.body.envelope.envelopeId}`).query({ token });
    expect(ctxRes.body).toMatchObject({ ok: false, code: "COSIGN_LINK_INVALID" });
  });

  it("status is only visible to the sender's company", async () => {
    col("signed_messages")["env-other"] = { status: "SIGNED", payload: { companyId: "other-co" }, signatures: [{}] };
    const app = buildApp(async () => {});
    expect((await request(app).get("/v1/sign/status/env-other")).status).toBe(404);
  });
});
