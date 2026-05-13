/**
 * @file extension-auth.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/extension/auth — exchange a Firebase Auth ID token for a
 * long-lived (30-day) JWS that the Chrome extension stores and presents
 * as a Bearer on every /v1/sign* call (TDD §11.4, PRD §11.4, PFL-061).
 *
 * Flow:
 *   1. Verify the ID token via firebase-admin/auth.
 *   2. Look up users/{uid}. If absent (first-time install for this
 *      Google account), auto-create a minimal stub keyed by uid with the
 *      email from the verified token. This makes "any Google account
 *      can demo the extension" true without forcing a full onboarding
 *      flow first.
 *   3. Mint a JWS extension auth token (HS256, PROOFLINE_AUTH_JWT_SECRET).
 *   4. Return { authToken, userId, companyId, credentialId }.
 *
 * Token format (HS256 JWS) — mirrors api/bilateral/jws.helpers.ts so we
 * keep one signing primitive in the codebase:
 *
 *   header:  { alg: "HS256", typ: "JWT" }
 *   payload: { v: 1, userId, companyId, extInstallId, iss, iat, exp }
 *   sig:     HMAC-SHA256(header.payload, PROOFLINE_AUTH_JWT_SECRET)
 *
 * Verification of this token by /v1/sign* is intentionally NOT wired here
 * — that lives in a follow-up ticket that swaps the stub auth middleware
 * for a real one. This handler only ISSUES the token.
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import * as crypto from "node:crypto";

import type { DeviceRecord } from "@proofline/types";
import { ERR } from "../api/onboarding/http.helpers.js";

// ─── Config ───────────────────────────────────────────────────────────────────

// 30 days, in seconds (PRD §11.4).
const EXT_AUTH_TTL_SEC = 30 * 24 * 60 * 60;

const ISSUER = "proofline-extension-auth";

function getSecret(): string {
  return (process.env["PROOFLINE_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod").trim();
}

// ─── Request schema ───────────────────────────────────────────────────────────

const ExtensionAuthRequestSchema = z.object({
  idToken:      z.string().min(20, "idToken must be a Firebase ID token"),
  extInstallId: z.string().min(1, "extInstallId is required"),
});

export type ExtensionAuthRequest = z.infer<typeof ExtensionAuthRequestSchema>;

export interface ExtensionAuthResponse {
  authToken:    string;
  userId:       string;
  companyId:    string;
  credentialId: string;
  email:        string;
}

// ─── Stored user record (subset we care about) ───────────────────────────────

interface UserDoc {
  userId:    string;
  email:     string;
  companyId: string;
  // PFL-088: policy-relevant fields persisted at first-auth so
  // validatePolicy doesn't have to fall back to permissive defaults.
  // Loose string/number types here on purpose — the read path
  // (firestore-policy-context.ts) narrows to UserRecord's literal unions.
  role?:          string;
  status?:        string;
  wireLimitUsd?:  number;
  dailyLimitUsd?: number;
  // Canonical schema (packages/types: User.devices: DeviceRecord[]). The
  // signing read-path (validatePolicy, sign-finalize) calls
  // `user.devices.find(...)` so the field MUST be an array, never a flat
  // `credentialId` string. PFL-084 removed the legacy flat field.
  devices:   DeviceRecord[];
  createdAt: number;
  updatedAt: number;
}

// PFL-088: hackathon-grade defaults applied at the first /v1/extension/auth
// call for each Firebase UID. Owners can later customize per user via an
// onboarding wizard; until then these numbers are generous enough to demo
// the $400k wire path without tripping POLICY_AUTHORITY_EXCEEDED while
// staying within plausible owner-level authority.
const DEFAULT_ROLE            = "owner";
const DEFAULT_STATUS          = "active";
const DEFAULT_WIRE_LIMIT_USD  = 500_000;
const DEFAULT_DAILY_LIMIT_USD = 2_000_000;

// Placeholder credentialId returned in the auth response when the user
// hasn't enrolled a WebAuthn credential yet — the extension popup uses
// this sentinel to decide "register a credential first". We never persist
// this string to the user document; the persisted shape is `devices: []`
// until the first real enrolment lands in register-credential.handler.ts.
const PLACEHOLDER_CREDENTIAL_ID = "placeholder-credential-id";

// Hackathon-mode companyId for users who haven't completed onboarding.
// Mirrors the stub used by stubAuthMiddleware in index.ts so the rest of
// the pipeline (policy, signing) keeps working.
const DEMO_COMPANY_ID = "dev-company";

// ─── Token issuance ──────────────────────────────────────────────────────────

interface IssueTokenInput {
  userId:       string;
  companyId:    string;
  extInstallId: string;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function issueExtensionAuthToken(input: IssueTokenInput): {
  token: string;
  iat:   number;
  exp:   number;
} {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + EXT_AUTH_TTL_SEC;

  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    v:            1,
    iss:          ISSUER,
    userId:       input.userId,
    companyId:    input.companyId,
    extInstallId: input.extInstallId,
    iat,
    exp,
  }));

  const sigInput = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(sigInput)
    .digest("base64url");

  return { token: `${sigInput}.${sig}`, iat, exp };
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface ExtensionAuthHandlerDeps {
  /**
   * Verify a Firebase ID token. Defaults to firebase-admin/auth.
   * Injected for tests so we don't need a live Firebase project.
   */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
}

export function makeExtensionAuthHandler(deps: ExtensionAuthHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });

  return async function extensionAuthHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const parsed = ExtensionAuthRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { idToken, extInstallId } = parsed.data;

    // 1. Verify Firebase ID token.
    let decoded: { uid: string; email?: string };
    try {
      decoded = await verifyIdToken(idToken);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "ID token verification failed";
      res.status(401).json(ERR.unauthorized(detail));
      return;
    }

    // 2. Look up users/{uid}. Auto-create on miss (hackathon mode).
    const firestore = getFirestore();
    const userRef   = firestore.collection("users").doc(decoded.uid);
    const userSnap  = await userRef.get();

    let user: UserDoc;
    if (userSnap.exists) {
      // PFL-088: never overwrite policy fields on the existing-user path.
      // An owner may have already customized wireLimitUsd / role for this
      // user; subsequent /v1/extension/auth calls are auth refreshes, not
      // re-onboarding.
      user = userSnap.data() as UserDoc;
    } else {
      const now = Date.now();
      user = {
        userId:        decoded.uid,
        email:         decoded.email ?? "",
        companyId:     DEMO_COMPANY_ID,
        role:          DEFAULT_ROLE,
        status:        DEFAULT_STATUS,
        wireLimitUsd:  DEFAULT_WIRE_LIMIT_USD,
        dailyLimitUsd: DEFAULT_DAILY_LIMIT_USD,
        devices:       [],
        createdAt:     now,
        updatedAt:     now,
      };
      await userRef.set(user, { merge: false });
    }

    // 3. Mint JWS extension auth token.
    const { token } = issueExtensionAuthToken({
      userId:       user.userId,
      companyId:    user.companyId,
      extInstallId,
    });

    // 4. Return. The response surfaces the primary device's credentialId
    //    (devices[0]) when one is enrolled, or PLACEHOLDER_CREDENTIAL_ID
    //    when this is a brand-new user — the extension popup uses the
    //    placeholder to know it needs to run a WebAuthn registration.
    const primaryCredentialId = Array.isArray(user.devices) && user.devices.length > 0
      ? (user.devices[0] as DeviceRecord).credentialId
      : PLACEHOLDER_CREDENTIAL_ID;
    const response: ExtensionAuthResponse = {
      authToken:    token,
      userId:       user.userId,
      companyId:    user.companyId,
      credentialId: primaryCredentialId,
      email:        user.email ?? decoded.email ?? "",
    };
    res.status(200).json(response);
  };
}
