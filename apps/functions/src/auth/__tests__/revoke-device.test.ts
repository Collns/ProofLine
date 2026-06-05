/**
 * @file revoke-device.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-085 — POST /v1/admin/revoke-device contract tests.
 *
 * Mirrors the in-memory Firestore mock the other auth tests use, but
 * adds support for `where().where().where().get()` (the session sweep)
 * and `collection().add()` (the audit log).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock (chained where + add + batch) ──────────────────

const store: Record<string, Record<string, unknown>> = {};

interface WhereClause { field: string; op: string; value: unknown }

function matchesAllClauses(doc: Record<string, unknown>, clauses: WhereClause[]): boolean {
  for (const c of clauses) {
    if (c.op !== "==") return false;
    if (doc[c.field] !== c.value) return false;
  }
  return true;
}

function makeDocRef(col: string, id: string) {
  const ref = {
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
    // Used by batch
    __col: col,
    __id:  id,
  };
  return ref;
}

function makeQuery(col: string, clauses: WhereClause[]) {
  const collect = () => {
    const docs = store[col] ?? {};
    return Object.entries(docs)
      .filter(([, data]) => matchesAllClauses(data as Record<string, unknown>, clauses))
      .map(([id, data]) => ({ id, data: () => data, ref: makeDocRef(col, id) }));
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
              store[ref.__col][ref.__id] = { ...(store[ref.__col][ref.__id] as object), ...data };
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
    verifyIdToken: vi.fn(async () => { throw new Error("not used in revoke-device tests"); }),
  }),
}));

import { makeRevokeDeviceHandler } from "../revoke-device.handler.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function buildApp(opts: Parameters<typeof makeRevokeDeviceHandler>[0] = {}) {
  const app = express();
  app.use(express.json());
  const handler = makeRevokeDeviceHandler(opts);
  app.post("/v1/admin/revoke-device", (req, res, next) => {
    handler(req, res).catch(next);
  });
  return app;
}

function authStub(userId: string, companyId: string) {
  return (() => ({
    ok:     true as const,
    claims: { userId, companyId, extInstallId: "ext-1", iat: 1, exp: 2_000_000_000 },
  })) as NonNullable<Parameters<typeof makeRevokeDeviceHandler>[0]>["verifyAuthorization"];
}

function authFailStub() {
  return (() => ({
    ok:     false as const,
    code:   "INVALID_TOKEN" as const,
    detail: "bad token",
  })) as NonNullable<Parameters<typeof makeRevokeDeviceHandler>[0]>["verifyAuthorization"];
}

function seedUser(
  userId: string,
  opts: {
    companyId?: string;
    role?:      string;
    devices?:   Array<{ credentialId: string; publicKey?: string; enrolledAt?: number; revokedAt?: number; deviceName?: string }>;
  } = {},
) {
  store["users"] = store["users"] ?? {};
  store["users"][userId] = {
    userId,
    companyId: opts.companyId ?? "co-acme",
    role:      opts.role      ?? "employee",
    status:    "active",
    devices:   (opts.devices ?? []).map((d) => ({
      credentialId: d.credentialId,
      publicKey:    d.publicKey ?? "spki",
      enrolledAt:   d.enrolledAt ?? 0,
      ...(d.revokedAt !== undefined ? { revokedAt: d.revokedAt } : {}),
      ...(d.deviceName ? { deviceName: d.deviceName } : {}),
    })),
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /v1/admin/revoke-device", () => {
  it("self-revokes the caller's own device", async () => {
    seedUser("user-1", {
      role: "employee",
      devices: [
        { credentialId: "cred-a", deviceName: "iPhone" },
        { credentialId: "cred-b", deviceName: "Mac" },
      ],
    });

    const app = buildApp({
      verifyAuthorization: authStub("user-1", "co-acme"),
      now: () => 1_750_000_000_000,
    });

    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "user-1", credentialId: "cred-a" })
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      userId: "user-1",
      credentialId: "cred-a",
      revokedAt: 1_750_000_000_000,
      sessionsRevoked: 0,
    });

    const userDoc = store["users"]!["user-1"] as Record<string, unknown>;
    const devices = userDoc["devices"] as Array<Record<string, unknown>>;
    expect(devices[0]?.["revokedAt"]).toBe(1_750_000_000_000);
    expect(devices[1]?.["revokedAt"]).toBeUndefined();   // sibling untouched
  });

  it("allows an owner in the same company to revoke a teammate's device", async () => {
    seedUser("owner-1", { role: "owner", devices: [] });
    seedUser("emp-1", {
      role: "employee",
      devices: [{ credentialId: "cred-emp-001" }],
    });

    const app = buildApp({ verifyAuthorization: authStub("owner-1", "co-acme") });

    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", credentialId: "cred-emp-001" })
      .expect(200);

    const empDoc = store["users"]!["emp-1"] as Record<string, unknown>;
    const devices = empDoc["devices"] as Array<Record<string, unknown>>;
    expect(typeof devices[0]?.["revokedAt"]).toBe("number");
  });

  it("allows a manager in the same company to revoke an employee's device", async () => {
    seedUser("mgr-1", { role: "manager", devices: [] });
    seedUser("emp-1", { role: "employee", devices: [{ credentialId: "cred-emp" }] });

    const app = buildApp({ verifyAuthorization: authStub("mgr-1", "co-acme") });
    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-1", credentialId: "cred-emp" })
      .expect(200);
  });

  it("returns 401 when the Bearer is missing/invalid", async () => {
    const app = buildApp({ verifyAuthorization: authFailStub() });
    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer bad")
      .send({ userId: "x", credentialId: "y" })
      .expect(401);
  });

  it("returns 400 on bad body", async () => {
    seedUser("user-1");
    const app = buildApp({ verifyAuthorization: authStub("user-1", "co-acme") });
    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "" })
      .expect(400);
  });

  it("returns 404 USER_NOT_FOUND when the target user doc doesn't exist", async () => {
    const app = buildApp({ verifyAuthorization: authStub("ghost", "co-acme") });
    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "ghost", credentialId: "cred" })
      .expect(404);
    expect(res.body.title).toBe("USER_NOT_FOUND");
  });

  it("returns 404 DEVICE_NOT_FOUND when the credentialId is not on the user's devices[]", async () => {
    seedUser("user-1", { devices: [{ credentialId: "cred-real" }] });
    const app = buildApp({ verifyAuthorization: authStub("user-1", "co-acme") });
    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "user-1", credentialId: "cred-not-mine" })
      .expect(404);
    expect(res.body.title).toBe("DEVICE_NOT_FOUND");
  });

  it("returns 403 NOT_AUTHORIZED when an employee tries to revoke a teammate's device", async () => {
    seedUser("emp-other", { role: "employee", devices: [] });
    seedUser("emp-victim", { role: "employee", devices: [{ credentialId: "cred-v" }] });

    const app = buildApp({ verifyAuthorization: authStub("emp-other", "co-acme") });
    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-victim", credentialId: "cred-v" })
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("returns 403 NOT_AUTHORIZED when caller is owner of a DIFFERENT company", async () => {
    seedUser("owner-evil", { role: "owner", companyId: "co-evil", devices: [] });
    seedUser("emp-victim", { role: "employee", companyId: "co-acme", devices: [{ credentialId: "cred-v" }] });

    const app = buildApp({ verifyAuthorization: authStub("owner-evil", "co-evil") });
    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "emp-victim", credentialId: "cred-v" })
      .expect(403);
  });

  it("is idempotent: re-revoking the same device keeps the original revokedAt", async () => {
    seedUser("user-1", { devices: [{ credentialId: "cred-a", revokedAt: 1_700_000_000_000 }] });
    const app = buildApp({
      verifyAuthorization: authStub("user-1", "co-acme"),
      now: () => 1_750_000_000_000,
    });
    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "user-1", credentialId: "cred-a" })
      .expect(200);
    expect(res.body.revokedAt).toBe(1_700_000_000_000); // preserved
  });

  it("revokes active sessions bound to the device and reports the count", async () => {
    seedUser("user-1", { devices: [{ credentialId: "cred-a" }] });
    store["sessions"] = {
      "sess-active-1": {
        sessionId: "sess-active-1",
        userId:    "user-1",
        companyId: "co-acme",
        deviceCredentialId: "cred-a",
        status:    "active",
      },
      "sess-active-2": {
        sessionId: "sess-active-2",
        userId:    "user-1",
        companyId: "co-acme",
        deviceCredentialId: "cred-a",
        status:    "active",
      },
      "sess-other-device": {
        sessionId: "sess-other-device",
        userId:    "user-1",
        companyId: "co-acme",
        deviceCredentialId: "cred-different",
        status:    "active",
      },
      "sess-already-revoked": {
        sessionId: "sess-already-revoked",
        userId:    "user-1",
        companyId: "co-acme",
        deviceCredentialId: "cred-a",
        status:    "revoked",
      },
    };

    const app = buildApp({ verifyAuthorization: authStub("user-1", "co-acme") });
    const res = await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "user-1", credentialId: "cred-a" })
      .expect(200);

    expect(res.body.sessionsRevoked).toBe(2);
    expect((store["sessions"]!["sess-active-1"] as Record<string, unknown>)["status"]).toBe("revoked");
    expect((store["sessions"]!["sess-active-2"] as Record<string, unknown>)["status"]).toBe("revoked");
    // Other device's session untouched.
    expect((store["sessions"]!["sess-other-device"] as Record<string, unknown>)["status"]).toBe("active");
    // Already-revoked session untouched.
    const already = store["sessions"]!["sess-already-revoked"] as Record<string, unknown>;
    expect(already["status"]).toBe("revoked");
  });

  it("emits an audit_events doc on success", async () => {
    seedUser("user-1", { devices: [{ credentialId: "cred-a" }] });
    const app = buildApp({
      verifyAuthorization: authStub("user-1", "co-acme"),
      now: () => 1_750_000_000_000,
    });
    await request(app)
      .post("/v1/admin/revoke-device")
      .set("Authorization", "Bearer x")
      .send({ userId: "user-1", credentialId: "cred-a" })
      .expect(200);

    const audits = Object.values(store["audit_events"] ?? {}) as Array<Record<string, unknown>>;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      type:         "DEVICE_REVOKED",
      userId:       "user-1",
      credentialId: "cred-a",
      revokedBy:    "user-1",
      reason:       "self_revoke",
    });
  });
});
