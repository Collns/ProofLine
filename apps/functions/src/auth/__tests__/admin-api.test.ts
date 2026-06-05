/**
 * @file admin-api.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-127 — admin API contract tests.
 *
 * Covers:
 *   - adminAuthMiddleware: 401 (missing/bad token), 403 (no user record /
 *     inactive / no company / wrong role / cross-company), happy path,
 *     ?cid= override (owner-only).
 *   - GET /v1/admin/company       — happy + 404.
 *   - GET /v1/admin/users         — sorted by role then createdAt; scoped.
 *   - GET /v1/admin/signed-messages — scoped to companyId via payload.companyId.
 *   - GET /v1/admin/sessions      — scoped + active-only.
 *   - GET /v1/admin/invitations   — scoped + newest-first.
 *
 * The Firestore mock supports chained where(), orderBy().limit(), and
 * direct doc().get(). It's intentionally local to this file — the other
 * auth tests already maintain their own mocks for their own subsets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── In-memory Firestore mock ────────────────────────────────────────────────

const store: Record<string, Record<string, Record<string, unknown>>> = {};

interface WhereClause { field: string; op: string; value: unknown }

function matchesAll(doc: Record<string, unknown>, clauses: WhereClause[]): boolean {
  for (const c of clauses) {
    if (c.op !== "==") return false;
    if (doc[c.field] !== c.value) return false;
  }
  return true;
}

function collect(
  col: string,
  clauses: WhereClause[],
  order?: { field: string; dir: "asc" | "desc" },
  limit?: number,
) {
  const docs = store[col] ?? {};
  let entries = Object.entries(docs).filter(([, data]) =>
    matchesAll(data, clauses),
  );
  if (order) {
    entries = entries.slice().sort((a, b) => {
      const av = a[1][order.field];
      const bv = b[1][order.field];
      const an = typeof av === "number" ? av : 0;
      const bn = typeof bv === "number" ? bv : 0;
      return order.dir === "asc" ? an - bn : bn - an;
    });
  }
  if (typeof limit === "number") entries = entries.slice(0, limit);
  return entries.map(([id, data]) => ({ id, data: () => data }));
}

function makeQuery(
  col: string,
  clauses: WhereClause[],
  order?: { field: string; dir: "asc" | "desc" },
) {
  return {
    where(field: string, op: string, value: unknown) {
      return makeQuery(col, [...clauses, { field, op, value }], order);
    },
    orderBy(field: string, dir: "asc" | "desc" = "asc") {
      return makeQuery(col, clauses, { field, dir });
    },
    limit(n: number) {
      return {
        async get() {
          const docs = collect(col, clauses, order, n);
          return { empty: docs.length === 0, docs };
        },
      };
    },
    async get() {
      const docs = collect(col, clauses, order);
      return { empty: docs.length === 0, docs };
    },
  };
}

function makeFirestoreMock(): FirebaseFirestore.Firestore {
  return {
    collection(col: string) {
      return {
        doc(id: string) {
          return {
            id,
            async get() {
              return {
                exists: Boolean(store[col]?.[id]),
                id,
                data:  () => store[col]?.[id] ?? null,
              };
            },
          };
        },
        where(field: string, op: string, value: unknown) {
          return makeQuery(col, [{ field, op, value }]);
        },
        orderBy(field: string, dir: "asc" | "desc" = "asc") {
          return makeQuery(col, [], { field, dir });
        },
      };
    },
  } as unknown as FirebaseFirestore.Firestore;
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
      throw new Error("verifyIdToken should be injected per test");
    }),
  }),
}));

import { makeAdminAuth } from "../admin-auth.middleware.js";
import {
  makeCompanyHandler,
  makeUsersHandler,
  makeSignedMessagesHandler,
  makeSessionsHandler,
  makeInvitationsHandler,
} from "../../api/admin/handlers.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function buildApp(opts: {
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
} = {}) {
  const app = express();
  app.use(express.json());
  const fs = makeFirestoreMock();
  const auth = makeAdminAuth({
    verifyIdToken: opts.verifyIdToken ?? (async () => ({ uid: "default" })),
    getFirestore: () => fs,
  });
  const deps = { getFirestore: () => fs };
  app.get("/v1/admin/company",         auth, (req, res, next) => makeCompanyHandler(deps)(req, res).catch(next));
  app.get("/v1/admin/users",           auth, (req, res, next) => makeUsersHandler(deps)(req, res).catch(next));
  app.get("/v1/admin/signed-messages", auth, (req, res, next) => makeSignedMessagesHandler(deps)(req, res).catch(next));
  app.get("/v1/admin/sessions",        auth, (req, res, next) => makeSessionsHandler(deps)(req, res).catch(next));
  app.get("/v1/admin/invitations",     auth, (req, res, next) => makeInvitationsHandler(deps)(req, res).catch(next));
  // Surface handler errors as JSON so test failures show the real cause.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[test] handler error:", err);
    res.status(500).json({ error: err.message });
  });
  return app;
}

function seedCaller(uid: string, opts: { role?: string; companyId?: string; status?: string; email?: string } = {}) {
  store["users"] = store["users"] ?? {};
  store["users"][uid] = {
    userId:    uid,
    companyId: opts.companyId ?? "co-acme",
    role:      opts.role      ?? "owner",
    status:    opts.status    ?? "active",
    email:     opts.email     ?? `${uid}@acme.com`,
  };
}

function seedCompany(companyId: string, doc: Record<string, unknown> = {}) {
  store["companies"] = store["companies"] ?? {};
  store["companies"][companyId] = {
    companyId,
    legalName:        "Acme Title Inc.",
    domain:           "acme.com",
    status:           "verified",
    onboardingStatus: "verified",
    rootPublicKey:    "x".repeat(124),
    kmsKeyName:       "projects/p/locations/global/keyRings/r/cryptoKeys/company-acme/cryptoKeyVersions/1",
    createdAt:        1_700_000_000_000,
    verifiedAt:       1_700_000_100_000,
    anchorTxHash:     "0xabc",
    anchorBlockNumber: 42,
    ...doc,
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Middleware ──────────────────────────────────────────────────────────────

describe("adminAuthMiddleware", () => {
  it("401 NO_AUTH_TOKEN when Authorization header is missing", async () => {
    const app = buildApp();
    const res = await request(app).get("/v1/admin/company").expect(401);
    expect(res.body.title).toBe("NO_AUTH_TOKEN");
  });

  it("401 NO_AUTH_TOKEN when Authorization is not a Bearer", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Basic abc")
      .expect(401);
    expect(res.body.title).toBe("NO_AUTH_TOKEN");
  });

  it("401 INVALID_TOKEN when verifyIdToken throws", async () => {
    const app = buildApp({
      verifyIdToken: async () => { throw new Error("Firebase ID token has been expired"); },
    });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer expired")
      .expect(401);
    expect(res.body.title).toBe("INVALID_TOKEN");
  });

  it("403 NO_USER_RECORD when the caller has no users/{uid} doc", async () => {
    const app = buildApp({ verifyIdToken: async () => ({ uid: "ghost" }) });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("NO_USER_RECORD");
  });

  it("403 NO_COMPANY when the caller's user doc has no companyId", async () => {
    seedCaller("u-1", { companyId: "" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "u-1" }) });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("NO_COMPANY");
  });

  it("403 USER_INACTIVE when the caller's status is not active", async () => {
    seedCaller("u-1", { status: "pending" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "u-1" }) });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("USER_INACTIVE");
  });

  it("403 NOT_AUTHORIZED for a plain employee", async () => {
    seedCaller("emp-1", { role: "employee" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "emp-1" }) });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("NOT_AUTHORIZED");
  });

  it("403 CROSS_COMPANY when a manager tries ?cid=<otherCompany>", async () => {
    seedCaller("mgr-1", { role: "manager", companyId: "co-acme" });
    seedCompany("co-acme");
    seedCompany("co-other", { ownerUserId: "someone-else" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "mgr-1" }) });
    const res = await request(app)
      .get("/v1/admin/company?cid=co-other")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("CROSS_COMPANY");
  });

  it("403 CROSS_COMPANY when owner targets a company they don't own", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    seedCompany("co-acme", { ownerUserId: "owner-1" });
    seedCompany("co-rival", { ownerUserId: "owner-rival" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/company?cid=co-rival")
      .set("Authorization", "Bearer x")
      .expect(403);
    expect(res.body.title).toBe("CROSS_COMPANY");
  });

  it("owner ?cid= override works when they own the target company", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    seedCompany("co-acme", { ownerUserId: "owner-1" });
    seedCompany("co-second", { ownerUserId: "owner-1", legalName: "Second Co" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/company?cid=co-second")
      .set("Authorization", "Bearer x")
      .expect(200);
    expect(res.body.companyId).toBe("co-second");
    expect(res.body.legalName).toBe("Second Co");
  });
});

// ─── GET /v1/admin/company ───────────────────────────────────────────────────

describe("GET /v1/admin/company", () => {
  it("returns the company profile scoped to the caller", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    seedCompany("co-acme", { ein: "12-3456789" });

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(200);

    expect(res.body).toMatchObject({
      companyId:        "co-acme",
      legalName:        "Acme Title Inc.",
      domain:           "acme.com",
      ein:              "12-3456789",
      status:           "verified",
      anchorTxHash:     "0xabc",
      anchorBlockNumber: 42,
    });
    // rootPublicKey is truncated server-side so the wire doesn't ship 124 chars.
    expect(typeof res.body.rootPublicKey).toBe("string");
    expect(res.body.rootPublicKey.length).toBeLessThan(124);
    expect(res.body.rootPublicKey).toContain("…");
  });

  it("404 when the company doc is missing", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-missing" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    await request(app)
      .get("/v1/admin/company")
      .set("Authorization", "Bearer x")
      .expect(404);
  });
});

// ─── GET /v1/admin/users ─────────────────────────────────────────────────────

describe("GET /v1/admin/users", () => {
  it("returns users scoped to caller's company, sorted owner→manager→employee", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    store["users"]!["mgr-1"] = {
      userId: "mgr-1", companyId: "co-acme", role: "manager", status: "active",
      email: "mgr@acme.com", displayName: "Manager", createdAt: 1_700_000_001,
      devices: [],
    };
    store["users"]!["emp-1"] = {
      userId: "emp-1", companyId: "co-acme", role: "employee", status: "active",
      email: "emp@acme.com", displayName: "Employee", createdAt: 1_700_000_002,
      devices: [{ credentialId: "cred-1", enrolledAt: 1, deviceName: "Mac", lastUsedAt: 2 }],
    };
    // OTHER company user — must NOT appear.
    store["users"]!["spy-1"] = {
      userId: "spy-1", companyId: "co-rival", role: "owner", status: "active",
      email: "spy@rival.com", displayName: "Rival", devices: [],
    };

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/users")
      .set("Authorization", "Bearer x")
      .expect(200);

    const ids = (res.body.users as Array<{ userId: string }>).map((u) => u.userId);
    expect(ids).toEqual(["owner-1", "mgr-1", "emp-1"]);
    expect(ids).not.toContain("spy-1");

    const emp = (res.body.users as Array<Record<string, unknown>>).find((u) => u["userId"] === "emp-1")!;
    expect((emp["devices"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      credentialId: "cred-1",
      deviceName:   "Mac",
      enrolledAt:   1,
      lastUsedAt:   2,
      revokedAt:    null,
    });
  });

  it("returns empty array when the company has no other users", async () => {
    seedCaller("solo-1", { role: "owner", companyId: "co-solo" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "solo-1" }) });
    const res = await request(app)
      .get("/v1/admin/users")
      .set("Authorization", "Bearer x")
      .expect(200);
    expect((res.body.users as unknown[])).toHaveLength(1);   // just the caller themselves
  });
});

// ─── GET /v1/admin/signed-messages ───────────────────────────────────────────

describe("GET /v1/admin/signed-messages", () => {
  it("returns messages scoped via payload.companyId, newest first", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    store["signed_messages"] = {
      "msg-old": {
        payload: { companyId: "co-acme", from: "a@acme.com", to: ["b@x.com"], subject: "Old" },
        signatures: [{ signerId: "owner-1", credentialId: "cred-1", signedAt: 100 }],
        createdAt: 100, status: "SIGNED",
      },
      "msg-new": {
        payload: { companyId: "co-acme", from: "a@acme.com", to: ["b@x.com"], subject: "New", isWireInstruction: true },
        signatures: [{ signerId: "owner-1", credentialId: "cred-1", signedAt: 999 }],
        createdAt: 999, status: "SIGNED",
        anchorTxHash: "0xabc", anchorBlockNumber: 100,
      },
      "msg-other-co": {
        payload: { companyId: "co-rival", from: "x@rival.com", to: ["y@x.com"], subject: "Spy" },
        signatures: [], createdAt: 5000, status: "SIGNED",
      },
    };

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/signed-messages")
      .set("Authorization", "Bearer x")
      .expect(200);

    const messages = res.body.messages as Array<Record<string, unknown>>;
    const ids = messages.map((m) => m["messageId"]);
    expect(ids).toEqual(["msg-new", "msg-old"]);   // newest first
    expect(ids).not.toContain("msg-other-co");

    const newMsg = messages.find((m) => m["messageId"] === "msg-new")!;
    expect(newMsg["isWireInstruction"]).toBe(true);
    expect(newMsg["anchorTxHash"]).toBe("0xabc");
    expect((newMsg["signatures"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      signerId: "owner-1", credentialId: "cred-1", signedAt: 999,
    });
  });

  it("returns empty array when no signed messages match", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-empty" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/signed-messages")
      .set("Authorization", "Bearer x")
      .expect(200);
    expect(res.body.messages).toEqual([]);
  });
});

// ─── GET /v1/admin/sessions ──────────────────────────────────────────────────

describe("GET /v1/admin/sessions", () => {
  it("returns active sessions for the caller's company, most-recent first", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    store["sessions"] = {
      "sess-1": {
        sessionId: "sess-1", userId: "owner-1", companyId: "co-acme",
        status: "active", recipientSetHash: "scope-1",
        recipientAddresses: ["client@x.com"],
        deviceCredentialId: "cred-1",
        authorizedAt: 100, expiresAt: 200, lastUsedAt: 150, signCount: 3,
      },
      "sess-2": {
        sessionId: "sess-2", userId: "owner-1", companyId: "co-acme",
        status: "active", recipientSetHash: "scope-2",
        recipientAddresses: ["other@x.com"],
        deviceCredentialId: "cred-1",
        authorizedAt: 500, expiresAt: 600, lastUsedAt: 550, signCount: 1,
      },
      "sess-revoked": {
        sessionId: "sess-revoked", userId: "owner-1", companyId: "co-acme",
        status: "revoked", deviceCredentialId: "cred-1",
        authorizedAt: 1000,
      },
      "sess-other-co": {
        sessionId: "sess-other-co", userId: "spy-1", companyId: "co-rival",
        status: "active", deviceCredentialId: "cred-x",
      },
    };

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/sessions")
      .set("Authorization", "Bearer x")
      .expect(200);

    const sessions = res.body.sessions as Array<Record<string, unknown>>;
    const ids = sessions.map((s) => s["sessionId"]);
    expect(ids).toEqual(["sess-2", "sess-1"]);   // most-recent authorizedAt first
    expect(ids).not.toContain("sess-revoked");
    expect(ids).not.toContain("sess-other-co");

    expect(sessions[0]).toMatchObject({
      userId:             "owner-1",
      recipientScope:     "scope-2",
      primaryRecipient:   "other@x.com",
      deviceCredentialId: "cred-1",
      authorizedAt:       500,
      expiresAt:          600,
      lastUsedAt:         550,
      signCount:          1,
    });
  });

  it("returns empty array when there are no active sessions", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/sessions")
      .set("Authorization", "Bearer x")
      .expect(200);
    expect(res.body.sessions).toEqual([]);
  });
});

// ─── GET /v1/admin/invitations ───────────────────────────────────────────────

describe("GET /v1/admin/invitations", () => {
  it("returns invitations scoped to caller's company, newest first", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    store["employee_invitations"] = {
      "inv-old": {
        invitationId: "inv-old", email: "a@gmail.com", companyId: "co-acme",
        role: "employee", invitedBy: "owner-1", status: "accepted",
        createdAt: 100, expiresAt: 200, acceptedAt: 150,
      },
      "inv-new": {
        invitationId: "inv-new", email: "b@gmail.com", companyId: "co-acme",
        role: "manager", invitedBy: "owner-1", status: "pending",
        createdAt: 999, expiresAt: 9_999,
      },
      "inv-other-co": {
        invitationId: "inv-other-co", email: "c@gmail.com", companyId: "co-rival",
        role: "employee", invitedBy: "spy-1", status: "pending",
        createdAt: 5_000, expiresAt: 9_999,
      },
    };

    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/invitations")
      .set("Authorization", "Bearer x")
      .expect(200);

    const invs = res.body.invitations as Array<Record<string, unknown>>;
    expect(invs.map((i) => i["invitationId"])).toEqual(["inv-new", "inv-old"]);
    expect(invs[0]).toMatchObject({
      email:     "b@gmail.com",
      role:      "manager",
      status:    "pending",
      invitedBy: "owner-1",
    });
    expect(invs.map((i) => i["invitationId"])).not.toContain("inv-other-co");
  });

  it("returns empty array when no invitations exist", async () => {
    seedCaller("owner-1", { role: "owner", companyId: "co-acme" });
    const app = buildApp({ verifyIdToken: async () => ({ uid: "owner-1" }) });
    const res = await request(app)
      .get("/v1/admin/invitations")
      .set("Authorization", "Bearer x")
      .expect(200);
    expect(res.body.invitations).toEqual([]);
  });
});
