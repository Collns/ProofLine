/**
 * @file require-extension-auth.middleware.ts
 * @module apps/functions/src/auth
 *
 * Express middleware that verifies the JWS Bearer token issued by
 * POST /v1/extension/auth (PFL-061) and sets `req.user` from the
 * decoded claims (PFL-087).
 *
 * Token format (HS256 JWS) — mirrors extension-auth.handler.ts:
 *
 *   header:  { alg: "HS256", typ: "JWT" }
 *   payload: { v: 1, iss: "proofline-extension-auth",
 *              userId, companyId, extInstallId, iat, exp }
 *   sig:     HMAC-SHA256(header.payload, EXT_AUTH_JWT_SECRET)
 *
 * Why a new middleware lives here (not just upgrading stubAuthMiddleware
 * in index.ts): /v1/onboard and /v1/bilateral still rely on the pass-
 * through stub today (bilateral does its own auth via the X-ProofLine-
 * Bilateral-Token header; onboarding will get real auth in a separate
 * ticket). Sign routes are the only place that needs the real user UID
 * threaded through to PolicyContext.getUser.
 *
 * HACKATHON CAVEAT: the HMAC secret is process.env.EXT_AUTH_JWT_SECRET
 * with a hardcoded dev fallback. Same secret as the issuer; same single-
 * instance limitation. A persistent secret / KMS rotation lands later.
 */

import type * as express from "express";
import * as crypto from "node:crypto";

import { makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Shared with extension-auth.handler.ts + register-credential.handler.ts ──

const EXPECTED_ISSUER = "proofline-extension-auth";

function getSecret(): string {
  return process.env["EXT_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod";
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface ExtensionAuthClaims {
  userId:       string;
  companyId:    string;
  extInstallId: string;
  iat:          number;
  exp:          number;
}

export type VerifyFailureCode =
  | "NO_AUTH_TOKEN"
  | "INVALID_AUTH_FORMAT"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "INVALID_TOKEN_CLAIMS";

export type VerifyResult =
  | { ok: true; claims: ExtensionAuthClaims }
  | { ok: false; code: VerifyFailureCode; detail: string };

// ─── Verifier (pure; injectable for tests) ───────────────────────────────────

export function verifyExtensionAuthBearer(authorizationHeader: string | undefined): VerifyResult {
  if (typeof authorizationHeader !== "string" || authorizationHeader.length === 0) {
    return { ok: false, code: "NO_AUTH_TOKEN", detail: "Missing Authorization header" };
  }
  if (!authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, code: "INVALID_AUTH_FORMAT", detail: "Authorization header must begin with 'Bearer '" };
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "INVALID_AUTH_FORMAT", detail: "Bearer token is not a well-formed JWS (header.payload.sig)" };
  }
  const [header, payload, sig] = parts as [string, string, string];

  // Constant-time signature check.
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
  const sigBuf = Buffer.from(sig,      "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, code: "INVALID_TOKEN", detail: "JWS signature does not verify" };
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, code: "INVALID_TOKEN", detail: "JWS payload is not valid JSON" };
  }

  if (claims["iss"] !== EXPECTED_ISSUER) {
    return { ok: false, code: "INVALID_TOKEN_CLAIMS", detail: `Unexpected issuer: ${String(claims["iss"])}` };
  }
  if (
    typeof claims["userId"]       !== "string" || (claims["userId"] as string).length === 0 ||
    typeof claims["companyId"]    !== "string" || (claims["companyId"] as string).length === 0 ||
    typeof claims["extInstallId"] !== "string" ||
    typeof claims["iat"]          !== "number" ||
    typeof claims["exp"]          !== "number"
  ) {
    return { ok: false, code: "INVALID_TOKEN_CLAIMS", detail: "Required claims (userId, companyId, extInstallId, iat, exp) missing or malformed" };
  }

  if ((claims["exp"] as number) < Math.floor(Date.now() / 1000)) {
    return { ok: false, code: "TOKEN_EXPIRED", detail: "Auth token has expired; re-run extension auth" };
  }

  return {
    ok:     true,
    claims: {
      userId:       claims["userId"]       as string,
      companyId:    claims["companyId"]    as string,
      extInstallId: claims["extInstallId"] as string,
      iat:          claims["iat"]          as number,
      exp:          claims["exp"]          as number,
    },
  };
}

// ─── Middleware factory ──────────────────────────────────────────────────────

export interface RequireExtensionAuthDeps {
  /** Inject a custom verifier for tests; defaults to the HMAC verifier above. */
  verify?: (authorizationHeader: string | undefined) => VerifyResult;
}

export function makeRequireExtensionAuth(
  deps: RequireExtensionAuthDeps = {},
): express.RequestHandler {
  const verify = deps.verify ?? verifyExtensionAuthBearer;

  return function requireExtensionAuth(req, res, next): void {
    const result = verify(req.headers.authorization);
    if (!result.ok) {
      // Structured log so the operator can grep for auth failures in prod
      // without sampling response bodies.
      // eslint-disable-next-line no-console
      console.warn(
        `[require-extension-auth] reject ${result.code}: ${result.detail} (path=${req.path})`,
      );
      res.status(401).json(
        makeRFC7807Error(
          `https://proofline.app/errors/${result.code}`,
          result.code,
          401,
          result.detail,
        ),
      );
      return;
    }
    (req as express.Request & {
      user: { userId: string; companyId: string };
    }).user = {
      userId:    result.claims.userId,
      companyId: result.claims.companyId,
    };
    next();
  };
}

/** Default middleware instance — wire-and-forget for index.ts. */
export const requireExtensionAuth = makeRequireExtensionAuth();
