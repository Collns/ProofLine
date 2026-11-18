/**
 * @file revoke-session.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-130 — POST /v1/admin/revoke-session.
 *
 * Mock shape follows update-status.test.ts (doc get/set + collection
 * add for the audit event); no batch needed here since the handler
 * touches exactly one session doc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};

function makeDocRef(col: string, id: string) {
  return {
    id,
    get: async () => ({
      exists: Boolean(store[col]?.[id]),
      data:   () => store[col]?.[id] ?? null,
    }),
    set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      store[col] = store[col] ?? {};
      if (opts?.merge && store[col][id]) {
        store[col][id] = { ...store[col][id], ...data };
      } else {
        store[col][id] = data;
      }
    },
  };
}

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
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
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps:       vi.fn(() => [{ name: "[DEFAULT]" }]),
  getApp:        vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(async () => { throw new Error("not used"); }),
  }),
}));

import { makeRevokeSessionHandler } from "../revoke-session.handler.js";

function buildApp(opts: Parameters<typeof makeRevokeSessionHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRevokeSessionHandler(opts);
  app.post("/v1/admin/revoke-session", (req, res, next) => handler(req, res).catch(next));
  return app;
}

function seedUser(
  uid: string,
  opts: { role?: string; companyId?: string; status?: string } = {},
) {
  store["users"] = store["users"] ?? {};
  store["users"][uid] = {
    userId:    uid,
    companyId: opts.companyId ?? "co-acme",
    role:      opts.role      ?? "employee",
    status:    opts.status    ?? "active",
  };
}

function seedSession(
  id: string,
  opts: { userId?: string; companyId?: string; status?: string } = {},
) {
  store["sessions"] = store["sessions"] ?? {};
  store["sessions"][id] = {
    sessionId: id,
    userId:    opts.userId    ?? "emp-1",
    companyId: opts.companyId ?? "co-acme",
    status:    opts.status    ?? "active",
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("POST /v1/admin/revoke-session", () => {
  it("owner revokes an active employee session + writes an audit event", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1",   { role: "employee" });
    seedSession("sess-1", { userId: "emp-1" });

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
      now: () => 1_750_000_000_000,
    });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-1" })
      .expect(200);

    expect(res.body).toEqual({
      ok: true, sessionId: "sess-1", revokedAt: 1_750_000_000_000,
    });

    const sess = store["sessions"]!["sess-1"] as Record<string, unknown>;
    expect(sess["status"]).toBe("revoked");
    expect(sess["revokedAt"]).toBe(1_750_000_000_000);
    expect(sess["revokedBy"]).toBe("owner-1");
    expect(sess["revokeReason"]).toBe("admin_manual");

    const audits = Object.values(store["audit_events"] ?? {});
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      type:         "SESSION_REVOKED",
      sessionId:    "sess-1",
      targetUserId: "emp-1",
      actorUserId:  "owner-1",
      companyId:    "co-acme",
      reason:       "admin_manual",
    });
  });

  it("manager revokes an employee's session", async () => {
    seedUser("mgr-1",  { role: "manager" });
    seedUser("emp-1",  { role: "employee" });
    seedSession("sess-1", { userId: "emp-1" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-1" })
      .expect(200);
    expect((store["sessions"]!["sess-1"] as Record<string, unknown>)["status"]).toBe("revoked");
  });

  it("manager revokes their own session", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedSession("sess-own", { userId: "mgr-1" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-own" })
      .expect(200);
    expect((store["sessions"]!["sess-own"] as Record<string, unknown>)["status"]).toBe("revoked");
  });

  it("manager CANNOT revoke the owner's session", async () => {
    seedUser("mgr-1",   { role: "manager" });
    seedUser("owner-1", { role: "owner" });
    seedSession("sess-owner", { userId: "owner-1" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-owner" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
    expect((store["sessions"]!["sess-owner"] as Record<string, unknown>)["status"]).toBe("active");
  });

  it("manager CANNOT revoke another manager's session", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedUser("mgr-2", { role: "manager" });
    seedSession("sess-mgr2", { userId: "mgr-2" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-mgr2" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("employee callers are rejected outright", async () => {
    seedUser("emp-1", { role: "employee" });
    seedSession("sess-own", { userId: "emp-1" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "emp-1" }) });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-own" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("403 CROSS_COMPANY when the session belongs to another company", async () => {
    seedUser("owner-1", { role: "owner", companyId: "co-acme" });
    seedSession("sess-rival", { userId: "emp-rival", companyId: "co-rival" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-rival" })
      .expect(403);
    expect(res.body.title).toBe("CROSS_COMPANY");
    expect((store["sessions"]!["sess-rival"] as Record<string, unknown>)["status"]).toBe("active");
  });

  it("409 SESSION_NOT_ACTIVE when the session is already revoked", async () => {
    seedUser("owner-1", { role: "owner" });
    seedSession("sess-dead", { userId: "emp-1", status: "revoked" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-dead" })
      .expect(409);
    expect(res.body.title).toBe("SESSION_NOT_ACTIVE");
  });

  it("404 when the session doesn't exist", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "ghost" })
      .expect(404);
  });

  it("401 when Bearer is missing", async () => {
    const app = buildApp();
    await request(app)
      .post("/v1/admin/revoke-session")
      .send({ sessionId: "sess-1" })
      .expect(401);
  });

  it("400 when sessionId is missing", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({})
      .expect(400);
  });

  it("403 when caller is deactivated", async () => {
    seedUser("owner-1", { role: "owner", status: "inactive" });
    seedSession("sess-1");
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/revoke-session")
      .set("Authorization", "Bearer x")
      .send({ sessionId: "sess-1" })
      .expect(403);
  });
});
