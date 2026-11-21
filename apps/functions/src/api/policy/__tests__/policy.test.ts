/**
 * PFL-188 — company unsigned-email policy: extension fetch (fail-closed
 * default block), override audit, and the owner/manager-only admin setter
 * (non-admins rejected, change audited).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};
function col(name: string) { store[name] = store[name] ?? {}; return store[name]!; }
function docRef(c: string, id: string) {
  return {
    id,
    async get() { const d = col(c)[id]; return { exists: Boolean(d), id, data: () => d }; },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      col(c)[id] = opts?.merge ? { ...(col(c)[id] ?? {}), ...data } : { ...data };
    },
  };
}
const db = {
  collection: (c: string) => ({
    doc: (id: string) => docRef(c, id),
    async add(data: Record<string, unknown>) {
      const id = `auto_${Object.keys(col(c)).length + 1}`;
      col(c)[id] = { ...data };
      return { id };
    },
  }),
};
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => db }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => [{}]), getApp: vi.fn() }));

import { makeGetPolicyHandler } from "../get-policy.handler.js";
import { makeUnsignedOverrideHandler } from "../unsigned-override.handler.js";
import { makeUpdateUnsignedPolicyHandler } from "../../../auth/update-unsigned-policy.handler.js";

const COMPANY = "co-1";
const USER = "u-1";

function extApp(handlerFactory: () => (req: express.Request, res: express.Response) => Promise<void>, user = { userId: USER, companyId: COMPANY }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { user: unknown }).user = user; next(); });
  app.all("/x", (req, res, next) => { handlerFactory()(req, res).catch(next); });
  return app;
}

function adminApp(callerUid: string) {
  const app = express();
  app.use(express.json());
  const handler = makeUpdateUnsignedPolicyHandler({ verifyIdToken: async () => ({ uid: callerUid }) });
  app.post("/x", (req, res, next) => { handler(req, res).catch(next); });
  return app;
}

/** supertest POST with the Bearer header the handler requires (token value is
 *  ignored — the injected verifyIdToken resolves the uid). */
function adminPost(callerUid: string, body: Record<string, unknown>) {
  return request(adminApp(callerUid)).post("/x").set("Authorization", "Bearer test").send(body);
}

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe("GET /v1/extension/policy", () => {
  it("defaults to block + override + footer-on for a company with no policy set", async () => {
    col("companies")[COMPANY] = { domain: "co-1.com" };
    const res = await request(extApp(makeGetPolicyHandler)).get("/x");
    expect(res.status).toBe(200);
    expect(res.body.policy).toEqual({ mode: "block", allowUnsignedOverride: true, appendUnsignedFooter: true });
  });

  it("returns the stored policy and defaults the footer to on when unset", async () => {
    col("companies")[COMPANY] = { unsignedEmailPolicy: { mode: "warn", allowUnsignedOverride: false } };
    const res = await request(extApp(makeGetPolicyHandler)).get("/x");
    expect(res.body.policy).toEqual({ mode: "warn", allowUnsignedOverride: false, appendUnsignedFooter: true });
  });

  it("returns the footer setting when the company turned it off", async () => {
    col("companies")[COMPANY] = { unsignedEmailPolicy: { mode: "allow", allowUnsignedOverride: true, appendUnsignedFooter: false } };
    const res = await request(extApp(makeGetPolicyHandler)).get("/x");
    expect(res.body.policy.appendUnsignedFooter).toBe(false);
  });

  it("defaults to block even when the company doc is missing", async () => {
    const res = await request(extApp(makeGetPolicyHandler)).get("/x");
    expect(res.body.policy.mode).toBe("block");
  });
});

describe("POST /v1/extension/unsigned-override", () => {
  it("writes an audit event with actor + company from the token, recording footerAdded", async () => {
    const res = await request(extApp(makeUnsignedOverrideHandler))
      .post("/x").send({ recipientSetHash: "abc", composeType: "inline_reply", policyMode: "block", footerAdded: true });
    expect(res.status).toBe(200);
    const events = Object.values(col("audit_events"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "UNSIGNED_SEND_OVERRIDE", actorUserId: USER, companyId: COMPANY,
      recipientSetHash: "abc", composeType: "inline_reply", policyAtTime: "block", footerAdded: true,
    });
  });

  it("defaults footerAdded to false when the field is absent", async () => {
    await request(extApp(makeUnsignedOverrideHandler))
      .post("/x").send({ recipientSetHash: "abc", composeType: "new_compose", policyMode: "warn" });
    const events = Object.values(col("audit_events"));
    expect(events[0]).toMatchObject({ footerAdded: false });
  });

  it("records the stable compose id, and the Gmail draft id when present", async () => {
    await request(extApp(makeUnsignedOverrideHandler))
      .post("/x").send({ composeType: "new_compose", policyMode: "block", composeId: "pfl-c1", draftId: "r-123" });
    const events = Object.values(col("audit_events"));
    expect(events[0]).toMatchObject({ composeId: "pfl-c1", draftId: "r-123" });
  });

  it("omits draftId when Gmail has no draft id (inline reply/forward)", async () => {
    await request(extApp(makeUnsignedOverrideHandler))
      .post("/x").send({ composeType: "inline_reply", policyMode: "block", composeId: "pfl-c2" });
    const event = Object.values(col("audit_events"))[0]!;
    expect(event).toMatchObject({ composeId: "pfl-c2" });
    expect(event).not.toHaveProperty("draftId");
  });
});

describe("POST /v1/admin/update-unsigned-policy", () => {
  it("lets an owner set the policy (incl. the footer) and audits the change", async () => {
    col("users")[USER] = { companyId: COMPANY, role: "owner", status: "active" };
    const res = await adminPost(USER, { mode: "warn", allowUnsignedOverride: false, appendUnsignedFooter: false });
    expect(res.status).toBe(200);
    expect(res.body.policy).toEqual({ mode: "warn", allowUnsignedOverride: false, appendUnsignedFooter: false });
    expect(col("companies")[COMPANY]).toMatchObject({
      unsignedEmailPolicy: { mode: "warn", allowUnsignedOverride: false, appendUnsignedFooter: false },
    });
    const events = Object.values(col("audit_events"));
    expect(events[0]).toMatchObject({
      type: "UNSIGNED_POLICY_UPDATED", actorUserId: USER, companyId: COMPANY, mode: "warn", appendUnsignedFooter: false,
    });
  });

  it("defaults the footer to on when the field is omitted", async () => {
    col("users")[USER] = { companyId: COMPANY, role: "owner", status: "active" };
    const res = await adminPost(USER, { mode: "allow", allowUnsignedOverride: true });
    expect(res.status).toBe(200);
    expect(res.body.policy.appendUnsignedFooter).toBe(true);
  });

  it("lets a manager set the policy", async () => {
    col("users")[USER] = { companyId: COMPANY, role: "manager", status: "active" };
    const res = await adminPost(USER, { mode: "allow", allowUnsignedOverride: true });
    expect(res.status).toBe(200);
  });

  it("rejects an employee (non-admin) with 403 and writes nothing", async () => {
    col("users")[USER] = { companyId: COMPANY, role: "employee", status: "active" };
    const res = await adminPost(USER, { mode: "allow", allowUnsignedOverride: true });
    expect(res.status).toBe(403);
    expect(col("companies")[COMPANY]).toBeUndefined();
  });

  it("rejects a malformed mode", async () => {
    col("users")[USER] = { companyId: COMPANY, role: "owner", status: "active" };
    const res = await adminPost(USER, { mode: "nope", allowUnsignedOverride: true });
    expect(res.status).toBe(400);
  });
});
