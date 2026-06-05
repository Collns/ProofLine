/**
 * @file update-role.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-128 — POST /v1/admin/update-role.
 *
 * The Firestore mock is intentionally small: just doc().get/set and
 * collection().add() for the audit log. update-role does no queries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => ({
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

import { makeUpdateRoleHandler } from "../update-role.handler.js";

function buildApp(opts: Parameters<typeof makeUpdateRoleHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeUpdateRoleHandler(opts);
  app.post("/v1/admin/update-role", (req, res, next) => handler(req, res).catch(next));
  return app;
}

function seedUser(uid: string, opts: { role?: string; companyId?: string; status?: string } = {}) {
  store["users"] = store["users"] ?? {};
  store["users"][uid] = {
    userId:    uid,
    companyId: opts.companyId ?? "co-acme",
    role:      opts.role      ?? "employee",
    status:    opts.status    ?? "active",
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("POST /v1/admin/update-role", () => {
  it("owner promotes an employee to manager", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1",   { role: "employee" });

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
      now: () => 1_750_000_000_000,
    });

    const res = await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", role: "manager" })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true, userId: "emp-1", role: "manager", companyId: "co-acme",
    });
    const target = store["users"]!["emp-1"] as Record<string, unknown>;
    expect(target["role"]).toBe("manager");
    expect(target["updatedAt"]).toBe(1_750_000_000_000);

    // Audit event landed with from/to roles.
    const audits = Object.values(store["audit_events"] ?? {});
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      type: "ROLE_UPDATED",
      targetUserId: "emp-1",
      actorUserId:  "owner-1",
      fromRole:     "employee",
      toRole:       "manager",
    });
  });

  it("owner demotes a manager to employee", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("mgr-1",   { role: "manager" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "mgr-1", role: "employee" })
      .expect(200);

    expect((store["users"]!["mgr-1"] as Record<string, unknown>)["role"]).toBe("employee");
  });

  it("401 when Authorization header is missing", async () => {
    const app = buildApp();
    await request(app)
      .post("/v1/admin/update-role")
      .send({ userId: "x", role: "manager" })
      .expect(401);
  });

  it("401 when verifyIdToken throws", async () => {
    const app = buildApp({ verifyIdToken: async () => { throw new Error("bad"); } });
    await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer bad")
      .send({ userId: "x", role: "manager" })
      .expect(401);
  });

  it("403 NOT_AUTHORIZED when caller is a manager (only owners may change roles)", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedUser("emp-1", { role: "employee" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", role: "manager" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
    // Side-effect-free on failure.
    expect((store["users"]!["emp-1"] as Record<string, unknown>)["role"]).toBe("employee");
  });

  it("403 SELF_CHANGE when caller targets themselves", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "owner-1", role: "manager" })
      .expect(403);
    expect(res.body.title).toBe("SELF_CHANGE");
  });

  it("403 CROSS_COMPANY when target lives in a different company", async () => {
    seedUser("owner-1", { role: "owner", companyId: "co-acme" });
    seedUser("emp-rival", { role: "employee", companyId: "co-rival" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-rival", role: "manager" })
      .expect(403);
    expect(res.body.title).toBe("CROSS_COMPANY");
  });

  it("403 OWNER_TRANSFER_REQUIRED when trying to change an owner's role", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("owner-2", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "owner-2", role: "manager" })
      .expect(403);
    expect(res.body.title).toBe("OWNER_TRANSFER_REQUIRED");
  });

  it("400 when role is not in {employee, manager} (e.g. 'owner')", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1", { role: "employee" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", role: "owner" })
      .expect(400);
  });

  it("404 when the target user doesn't exist", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/update-role")
      .set("Authorization", "Bearer x")
      .send({ userId: "ghost", role: "manager" })
      .expect(404);
  });
});
