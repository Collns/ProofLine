/**
 * PFL-166 — Firebase ID-token middleware for /v1/onboard and /v1/bilateral.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { makeFirebaseAuth } from "../firebase-auth.middleware.js";

type UserDoc = { companyId?: string; status?: string; role?: string };

function firestoreWith(users: Record<string, UserDoc>) {
  return () =>
    ({
      collection: (_col: string) => ({
        doc: (id: string) => ({
          get: async () => ({ exists: id in users, data: () => users[id] }),
        }),
      }),
    }) as unknown as FirebaseFirestore.Firestore;
}

const verifyIdToken = vi.fn(async (token: string) => {
  if (token === "good-token") return { uid: "uid-1", email: "owner@acme.test" };
  if (token === "other-token") return { uid: "uid-2" };
  throw new Error("Firebase ID token has invalid signature");
});

function appWith(mw: express.RequestHandler, preset?: Record<string, unknown>) {
  const app = express();
  if (preset) {
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = preset;
      next();
    });
  }
  app.use(mw);
  app.get("/whoami", (req, res) => {
    res.json({ user: (req as unknown as { user?: unknown }).user ?? null });
  });
  return app;
}

describe("makeFirebaseAuth — requireCompany: false (onboarding)", () => {
  const mw = makeFirebaseAuth(
    { requireCompany: false },
    { verifyIdToken, getFirestore: firestoreWith({}) },
  );

  it("401 NO_AUTH_TOKEN without an Authorization header", async () => {
    const res = await request(appWith(mw)).get("/whoami").expect(401);
    expect(res.body.title).toBe("NO_AUTH_TOKEN");
  });

  it("401 NO_AUTH_TOKEN for a non-Bearer header", async () => {
    await request(appWith(mw)).get("/whoami").set("Authorization", "Basic abc").expect(401);
  });

  it("401 INVALID_TOKEN when verification fails (e.g. old placeholder tokens)", async () => {
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer DEV_PLACEHOLDER_TOKEN")
      .expect(401);
    expect(res.body.title).toBe("INVALID_TOKEN");
  });

  it("sets req.user from the verified token without needing a users doc", async () => {
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer good-token")
      .expect(200);
    expect(res.body.user).toEqual({ userId: "uid-1", email: "owner@acme.test" });
  });

  it("discards any identity set before the middleware", async () => {
    const app = appWith(mw, { userId: "dev-user", companyId: "dev-company" });
    await request(app).get("/whoami").expect(401);
    const res = await request(app)
      .get("/whoami")
      .set("Authorization", "Bearer other-token")
      .expect(200);
    expect(res.body.user).toEqual({ userId: "uid-2" });
  });
});

describe("makeFirebaseAuth — requireCompany: true (bilateral)", () => {
  const users: Record<string, UserDoc> = {
    "uid-1": { companyId: "co-acme", status: "active", role: "owner" },
    "uid-2": { companyId: "co-acme", status: "suspended" },
  };

  it("loads companyId and role from users/{uid}", async () => {
    const mw = makeFirebaseAuth(
      { requireCompany: true },
      { verifyIdToken, getFirestore: firestoreWith(users) },
    );
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer good-token")
      .expect(200);
    expect(res.body.user).toEqual({
      userId: "uid-1", email: "owner@acme.test", companyId: "co-acme", role: "owner",
    });
  });

  it("403 USER_INACTIVE for a suspended user", async () => {
    const mw = makeFirebaseAuth(
      { requireCompany: true },
      { verifyIdToken, getFirestore: firestoreWith(users) },
    );
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer other-token")
      .expect(403);
    expect(res.body.title).toBe("USER_INACTIVE");
  });

  it("403 NO_USER_RECORD when users/{uid} is missing", async () => {
    const mw = makeFirebaseAuth(
      { requireCompany: true },
      { verifyIdToken, getFirestore: firestoreWith({}) },
    );
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer good-token")
      .expect(403);
    expect(res.body.title).toBe("NO_USER_RECORD");
  });

  it("403 NO_COMPANY when the user has no companyId", async () => {
    const mw = makeFirebaseAuth(
      { requireCompany: true },
      { verifyIdToken, getFirestore: firestoreWith({ "uid-1": { status: "active" } }) },
    );
    const res = await request(appWith(mw))
      .get("/whoami")
      .set("Authorization", "Bearer good-token")
      .expect(403);
    expect(res.body.title).toBe("NO_COMPANY");
  });

  it("optional: passes through with no header, but still rejects a bad token", async () => {
    const mw = makeFirebaseAuth(
      { requireCompany: true, optional: true },
      { verifyIdToken, getFirestore: firestoreWith(users) },
    );
    const app = appWith(mw, { userId: "dev-user", companyId: "dev-company" });
    const anon = await request(app).get("/whoami").expect(200);
    expect(anon.body.user).toBeNull();
    await request(app).get("/whoami").set("Authorization", "Bearer forged").expect(401);
  });
});
