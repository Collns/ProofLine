/**
 * @file invite-employee.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-068 — POST /v1/admin/invite-employee contract tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock (chained where()) ──────────────────────────────

const store: Record<string, Record<string, unknown>> = {};

interface WhereClause {
  field: string;
  op:    string;
  value: unknown;
}

function matchesAll(doc: Record<string, unknown>, clauses: WhereClause[]): boolean {
  for (const c of clauses) {
    if (c.op !== "==") return false;
    if (doc[c.field] !== c.value) return false;
  }
  return true;
}

function makeQuery(col: string, clauses: WhereClause[]) {
  const collect = () => {
    const docs = store[col] ?? {};
    return Object.entries(docs)
      .filter(([, data]) => matchesAll(data as Record<string, unknown>, clauses))
      .map(([id, data]) => ({
        id,
        data: () => data,
        ref:  makeDocRef(col, id),
      }));
  };
  return {
    where: (field: string, op: string, value: unknown) =>
      makeQuery(col, [...clauses, { field, op, value }]),
    limit: (n: number) => ({
      get: async () => {
        const docs = collect().slice(0, n);
        return { empty: docs.length === 0, docs };
      },
    }),
    get: async () => {
      const docs = collect();
      return { empty: docs.length === 0, docs };
    },
  };
}

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
        store[col][id] = { ...(store[col][id] as object), ...data };
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
      where: (field: string, op: string, value: unknown) =>
        makeQuery(col, [{ field, op, value }]),
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
      throw new Error("verifyIdToken should be injected in tests");
    }),
  }),
}));

import {
  makeInviteEmployeeHandler,
  EMPLOYEE_INVITATIONS_COLLECTION,
  EMPLOYEE_INVITATION_TTL_MS,
} from "../invite-employee.handler.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function buildApp(opts: Parameters<typeof makeInviteEmployeeHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeInviteEmployeeHandler(opts);
  app.post("/v1/admin/invite-employee", (req, res, next) => {
    handler(req, res).catch(next);
  });
  return app;
}

function seedCaller(
  uid: string,
  overrides: { role?: string; companyId?: string; status?: string } = {},
) {
  store["users"] = store["users"] ?? {};
  store["users"][uid] = {
    userId:    uid,
    companyId: overrides.companyId ?? "co-acme",
    role:      overrides.role      ?? "owner",
    status:    overrides.status    ?? "active",
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/admin/invite-employee", () => {
  it("creates a pending invitation when called by an owner", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });

    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1", email: "alice@acme.com" }),
      now:           () => 1_750_000_000_000,
      newId:         () => "inv-fixed-001",
    });

    const res = await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer fake-id-token")
      .send({ email: "Sarah@Gmail.com", role: "employee" })
      .expect(200);

    expect(res.body).toMatchObject({
      ok:           true,
      invitationId: "inv-fixed-001",
      email:        "sarah@gmail.com",          // normalised
      companyId:    "co-acme",
      role:         "employee",
      expiresAt:    1_750_000_000_000 + EMPLOYEE_INVITATION_TTL_MS,
    });

    const stored = store[EMPLOYEE_INVITATIONS_COLLECTION]?.["inv-fixed-001"] as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      invitationId: "inv-fixed-001",
      email:        "sarah@gmail.com",
      companyId:    "co-acme",
      role:         "employee",
      invitedBy:    "owner-1",
      status:       "pending",
      createdAt:    1_750_000_000_000,
      expiresAt:    1_750_000_000_000 + EMPLOYEE_INVITATION_TTL_MS,
    });
  });

  it("accepts manager as the inviter role", async () => {
    seedCaller("mgr-1", { role: "manager" });
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "mgr-1", email: "mgr@acme.com" }),
    });

    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "alex@gmail.com", role: "manager" })
      .expect(200);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "x" }),
    });
    await request(app)
      .post("/v1/admin/invite-employee")
      .send({ email: "a@b.com", role: "employee" })
      .expect(401);
  });

  it("returns 401 when the Firebase ID token fails verification", async () => {
    const app = buildApp({
      verifyIdToken: async () => { throw new Error("invalid token"); },
    });
    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer bad")
      .send({ email: "a@b.com", role: "employee" })
      .expect(401);
  });

  it("returns 400 on missing or malformed body", async () => {
    seedCaller("owner-1");
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
    });
    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "not-an-email", role: "employee" })
      .expect(400);
    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "a@b.com", role: "admin" })   // role not in enum
      .expect(400);
  });

  it("returns 403 when the caller has no user doc", async () => {
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "ghost-uid" }),
    });
    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "a@b.com", role: "employee" })
      .expect(403);
  });

  it("returns 403 when the caller is a plain employee (not owner/manager)", async () => {
    seedCaller("emp-1", { role: "employee" });
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "emp-1" }),
    });
    const res = await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "a@b.com", role: "employee" })
      .expect(403);
    expect(res.body.detail).toMatch(/owners and managers/i);
  });

  it("returns 403 when the caller is not linked to a company", async () => {
    seedCaller("orphan-1", { role: "owner", companyId: "" });
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "orphan-1" }),
    });
    await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "a@b.com", role: "employee" })
      .expect(403);
  });

  it("returns 409 when a pending invitation for the same email + company already exists", async () => {
    seedCaller("owner-1");
    store[EMPLOYEE_INVITATIONS_COLLECTION] = {
      "existing-1": {
        invitationId: "existing-1",
        email:        "sarah@gmail.com",
        companyId:    "co-acme",
        role:         "employee",
        invitedBy:    "owner-1",
        status:       "pending",
        createdAt:    1_700_000_000_000,
        expiresAt:    9_999_999_999_999,
      },
    };
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
    });
    const res = await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "sarah@gmail.com", role: "employee" })
      .expect(409);
    expect(res.body.title).toBe("EMPLOYEE_INVITATION_PENDING");
  });

  it("allows re-inviting after the prior invitation was accepted (no duplicate guard)", async () => {
    seedCaller("owner-1");
    store[EMPLOYEE_INVITATIONS_COLLECTION] = {
      "accepted-1": {
        invitationId: "accepted-1",
        email:        "sarah@gmail.com",
        companyId:    "co-acme",
        status:       "accepted",
        role:         "employee",
        invitedBy:    "owner-1",
        createdAt:    1_700_000_000_000,
        expiresAt:    1_700_000_000_001,
      },
    };
    const app = buildApp({
      verifyIdToken: async () => ({ uid: "owner-1" }),
      newId:         () => "inv-fresh-002",
    });
    const res = await request(app)
      .post("/v1/admin/invite-employee")
      .set("Authorization", "Bearer x")
      .send({ email: "sarah@gmail.com", role: "manager" })
      .expect(200);
    expect(res.body.invitationId).toBe("inv-fresh-002");
  });
});
