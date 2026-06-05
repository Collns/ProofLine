/**
 * @file update-status.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-128 — POST /v1/admin/update-status.
 *
 * Needs `where().where().get()` (the session sweep) + `batch().set()`,
 * so the mock is slightly richer than update-role's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const store: Record<string, Record<string, Record<string, unknown>>> = {};

interface WhereClause { field: string; op: string; value: unknown }

function matchesAll(doc: Record<string, unknown>, clauses: WhereClause[]): boolean {
  for (const c of clauses) {
    if (c.op !== "==") return false;
    if (doc[c.field] !== c.value) return false;
  }
  return true;
}

function makeDocRef(col: string, id: string) {
  return {
    id,
    __col: col,
    __id:  id,
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

function makeQuery(col: string, clauses: WhereClause[]) {
  const collect = () => {
    const docs = store[col] ?? {};
    return Object.entries(docs)
      .filter(([, data]) => matchesAll(data, clauses))
      .map(([id, data]) => ({ id, data: () => data, ref: makeDocRef(col, id) }));
  };
  return {
    where: (field: string, op: string, value: unknown) =>
      makeQuery(col, [...clauses, { field, op, value }]),
    get: async () => {
      const docs = collect();
      return { empty: docs.length === 0, docs };
    },
  };
}

function makeFirestoreMock() {
  return {
    collection: (col: string) => ({
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, op: string, value: unknown) =>
        makeQuery(col, [{ field, op, value }]),
      add: async (data: Record<string, unknown>) => {
        store[col] = store[col] ?? {};
        const id = `auto_${Object.keys(store[col]).length + 1}`;
        store[col][id] = data;
        return { id };
      },
    }),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (
          ref: { __col: string; __id: string },
          data: Record<string, unknown>,
          opts?: { merge?: boolean },
        ) => {
          ops.push(() => {
            store[ref.__col] = store[ref.__col] ?? {};
            if (opts?.merge && store[ref.__col][ref.__id]) {
              store[ref.__col][ref.__id] = {
                ...store[ref.__col][ref.__id],
                ...data,
              };
            } else {
              store[ref.__col][ref.__id] = data;
            }
          });
        },
        commit: async () => { for (const op of ops) op(); },
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
    verifyIdToken: vi.fn(async () => { throw new Error("not used"); }),
  }),
}));

import { makeUpdateStatusHandler } from "../update-status.handler.js";

function buildApp(opts: Parameters<typeof makeUpdateStatusHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeUpdateStatusHandler(opts);
  app.post("/v1/admin/update-status", (req, res, next) => handler(req, res).catch(next));
  return app;
}

function seedUser(
  uid: string,
  opts: { role?: string; companyId?: string; status?: string; devices?: Array<Record<string, unknown>> } = {},
) {
  store["users"] = store["users"] ?? {};
  store["users"][uid] = {
    userId:    uid,
    companyId: opts.companyId ?? "co-acme",
    role:      opts.role      ?? "employee",
    status:    opts.status    ?? "active",
    devices:   opts.devices   ?? [],
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("POST /v1/admin/update-status", () => {
  it("owner deactivates an employee, revoking sessions + devices", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1", {
      role: "employee",
      devices: [
        { credentialId: "cred-a", enrolledAt: 100 },
        { credentialId: "cred-b", enrolledAt: 200, revokedAt: 300 }, // already revoked
      ],
    });
    store["sessions"] = {
      "sess-active-1": { sessionId: "sess-active-1", userId: "emp-1", companyId: "co-acme", status: "active" },
      "sess-active-2": { sessionId: "sess-active-2", userId: "emp-1", companyId: "co-acme", status: "active" },
      "sess-revoked":  { sessionId: "sess-revoked",  userId: "emp-1", companyId: "co-acme", status: "revoked" },
      "sess-other-user": { sessionId: "sess-other-user", userId: "user-other", companyId: "co-acme", status: "active" },
    };

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
      now: () => 1_750_000_000_000,
    });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", status: "inactive" })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true, userId: "emp-1", status: "inactive",
      sessionsRevoked: 2, devicesRevoked: 1,    // only the non-revoked device gets stamped
    });

    const target = store["users"]!["emp-1"] as Record<string, unknown>;
    expect(target["status"]).toBe("inactive");
    const devices = target["devices"] as Array<Record<string, unknown>>;
    expect(devices[0]?.["revokedAt"]).toBe(1_750_000_000_000);  // freshly stamped
    expect(devices[1]?.["revokedAt"]).toBe(300);                // pre-existing preserved

    expect((store["sessions"]!["sess-active-1"] as Record<string, unknown>)["status"]).toBe("revoked");
    expect((store["sessions"]!["sess-active-2"] as Record<string, unknown>)["status"]).toBe("revoked");
    expect((store["sessions"]!["sess-other-user"] as Record<string, unknown>)["status"]).toBe("active");
  });

  it("owner reactivates a deactivated employee — sessions/devices stay revoked", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1", {
      role: "employee", status: "inactive",
      devices: [{ credentialId: "cred-a", enrolledAt: 100, revokedAt: 999 }],
    });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", status: "active" })
      .expect(200);

    expect(res.body).toMatchObject({ status: "active", sessionsRevoked: 0, devicesRevoked: 0 });
    const target = store["users"]!["emp-1"] as Record<string, unknown>;
    expect(target["status"]).toBe("active");
    const devices = target["devices"] as Array<Record<string, unknown>>;
    // Reactivation deliberately does NOT clear revokedAt — devices need
    // re-enrollment after a deactivation.
    expect(devices[0]?.["revokedAt"]).toBe(999);
  });

  it("manager deactivates an employee", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedUser("emp-1", { role: "employee" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", status: "inactive" })
      .expect(200);

    expect((store["users"]!["emp-1"] as Record<string, unknown>)["status"]).toBe("inactive");
  });

  it("manager CANNOT deactivate another manager", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedUser("mgr-2", { role: "manager" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "mgr-2", status: "inactive" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
    // Side-effect-free.
    expect((store["users"]!["mgr-2"] as Record<string, unknown>)["status"]).toBe("active");
  });

  it("manager CANNOT deactivate the owner", async () => {
    seedUser("mgr-1", { role: "manager" });
    seedUser("owner-1", { role: "owner" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "owner-1", status: "inactive" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("owner CANNOT deactivate another owner", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("owner-2", { role: "owner" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "owner-2", status: "inactive" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("403 SELF_CHANGE when caller targets themselves", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "owner-1", status: "inactive" })
      .expect(403);
    expect(res.body.title).toBe("SELF_CHANGE");
  });

  it("403 CROSS_COMPANY when target is in a different company", async () => {
    seedUser("owner-1", { role: "owner", companyId: "co-acme" });
    seedUser("emp-rival", { role: "employee", companyId: "co-rival" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-rival", status: "inactive" })
      .expect(403);
    expect(res.body.title).toBe("CROSS_COMPANY");
  });

  it("401 when Bearer is missing", async () => {
    const app = buildApp();
    await request(app)
      .post("/v1/admin/update-status")
      .send({ userId: "x", status: "inactive" })
      .expect(401);
  });

  it("404 when target user doesn't exist", async () => {
    seedUser("owner-1", { role: "owner" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "ghost", status: "inactive" })
      .expect(404);
  });

  it("400 when status is not active/inactive", async () => {
    seedUser("owner-1", { role: "owner" });
    seedUser("emp-1",   { role: "employee" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .post("/v1/admin/update-status")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", status: "suspended" })
      .expect(400);
  });
});
