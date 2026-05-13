/**
 * @file require-extension-auth.test.ts
 * @module apps/functions/src/auth/__tests__
 *
 * PFL-087 — contract tests for the Bearer-JWS middleware that protects
 * /v1/sign, /v1/sign/finalize, /v1/sign-silent.
 *
 * Why this test matters: PFL-086 wired PolicyContext.getUser to read
 * Firestore, but the prior stubAuthMiddleware forced req.user.userId to
 * "dev-user" regardless of who actually called. This middleware is what
 * threads the real Firebase UID through to Firestore.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import * as crypto from "node:crypto";

import {
  requireExtensionAuth,
  makeRequireExtensionAuth,
  verifyExtensionAuthBearer,
} from "../require-extension-auth.middleware.js";

// ─── Test helpers ───────────────────────────────────────────────────────────

const SECRET   = process.env["EXT_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod";
const ISSUER   = "proofline-extension-auth";
const NOW_SEC  = Math.floor(Date.now() / 1000);

function mintToken(claims: {
  userId?:       string;
  companyId?:    string;
  extInstallId?: string;
  iss?:          string;
  iat?:          number;
  exp?:          number;
  v?:            number;
}): string {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    v:            claims.v            ?? 1,
    iss:          claims.iss          ?? ISSUER,
    userId:       claims.userId       ?? "user-firebase-uid-001",
    companyId:    claims.companyId    ?? "dev-company",
    extInstallId: claims.extInstallId ?? "ext-install-1",
    iat:          claims.iat          ?? NOW_SEC,
    exp:          claims.exp          ?? NOW_SEC + 3600,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Echo back what the middleware put on req.user so tests can assert it.
  app.get("/protected", requireExtensionAuth, (req, res) => {
    const u = (req as express.Request & { user?: { userId: string; companyId: string } }).user;
    res.status(200).json({ ok: true, user: u });
  });
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("requireExtensionAuth — happy path", () => {
  it("decodes a valid Bearer JWS and sets req.user from the claims", async () => {
    const token = mintToken({
      userId:    "VJELSYeEH1TJUA0ugGQQi93QAxx1",
      companyId: "acme-title",
    });

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      ok:   true,
      user: { userId: "VJELSYeEH1TJUA0ugGQQi93QAxx1", companyId: "acme-title" },
    });
  });

  it("verifyExtensionAuthBearer returns ok:true with parsed claims", () => {
    const token  = mintToken({ userId: "u-1", companyId: "co-1", extInstallId: "ext-9" });
    const result = verifyExtensionAuthBearer(`Bearer ${token}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.userId).toBe("u-1");
      expect(result.claims.companyId).toBe("co-1");
      expect(result.claims.extInstallId).toBe("ext-9");
    }
  });
});

describe("requireExtensionAuth — failure modes", () => {
  it("returns 401 NO_AUTH_TOKEN when the Authorization header is absent", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .expect(401);
    expect(res.body.title).toBe("NO_AUTH_TOKEN");
    expect(res.body.status).toBe(401);
    expect(res.body.type).toBe("https://proofline.app/errors/NO_AUTH_TOKEN");
  });

  it("returns 401 INVALID_AUTH_FORMAT when the header does not start with 'Bearer '", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz")
      .expect(401);
    expect(res.body.title).toBe("INVALID_AUTH_FORMAT");
  });

  it("returns 401 INVALID_AUTH_FORMAT when the Bearer value is not a 3-segment JWS", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer not.a.jws.token")
      .expect(401);
    expect(res.body.title).toBe("INVALID_AUTH_FORMAT");
  });

  it("returns 401 INVALID_TOKEN when the signature does not match", async () => {
    const valid = mintToken({});
    // Flip the last char of the signature segment — keep length stable so
    // the timing-safe compare still runs.
    const parts = valid.split(".") as [string, string, string];
    const sig   = parts[2];
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${tampered}`)
      .expect(401);
    expect(res.body.title).toBe("INVALID_TOKEN");
  });

  it("returns 401 TOKEN_EXPIRED when exp is in the past", async () => {
    const expired = mintToken({
      iat: NOW_SEC - 7200,
      exp: NOW_SEC - 3600,
    });
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);
    expect(res.body.title).toBe("TOKEN_EXPIRED");
  });

  it("returns 401 INVALID_TOKEN_CLAIMS when userId claim is missing", async () => {
    // Hand-build a token without userId — mintToken's defaults always set
    // one, so we synthesize the JSON directly.
    const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      v:            1,
      iss:          ISSUER,
      // userId intentionally omitted
      companyId:    "dev-company",
      extInstallId: "ext-1",
      iat:          NOW_SEC,
      exp:          NOW_SEC + 3600,
    })).toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
    const token = `${header}.${payload}.${sig}`;

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.title).toBe("INVALID_TOKEN_CLAIMS");
  });

  it("returns 401 INVALID_TOKEN_CLAIMS when iss is not proofline-extension-auth", async () => {
    const token = mintToken({ iss: "someone-else" });
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.title).toBe("INVALID_TOKEN_CLAIMS");
    expect(res.body.detail).toMatch(/issuer/i);
  });
});

describe("makeRequireExtensionAuth — DI override", () => {
  it("calls into the injected verifier instead of the default HMAC path", async () => {
    // Drop-in custom verifier — proves callers can override without going
    // through the real HMAC machinery.
    const middleware = makeRequireExtensionAuth({
      verify: (_h) => ({
        ok: true,
        claims: {
          userId:       "stub-injected-user",
          companyId:    "stub-injected-co",
          extInstallId: "ext-x",
          iat:          0,
          exp:          NOW_SEC + 600,
        },
      }),
    });

    const app = express();
    app.use(express.json());
    app.get("/p", middleware, (req, res) => {
      const u = (req as express.Request & { user?: { userId: string; companyId: string } }).user;
      res.status(200).json({ user: u });
    });

    const res = await request(app)
      .get("/p")
      .set("Authorization", "Bearer anything")
      .expect(200);
    expect(res.body.user.userId).toBe("stub-injected-user");
  });
});
