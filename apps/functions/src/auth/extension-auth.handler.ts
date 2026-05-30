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
  // PFL-067: true when the user's email domain didn't match any onboarded
  // company (or was a public provider like gmail.com). The extension popup
  // uses this to show "Your company isn't on ProofLine yet" instead of
  // silently dropping the user into a demo workspace.
  needsOnboarding?: boolean;
}

// ─── Stored user record (subset we care about) ───────────────────────────────

interface UserDoc {
  userId:    string;
  email:     string;
  // PFL-067: may be "" when the user's email domain didn't match any
  // onboarded company. The signing path treats an empty companyId as
  // un-onboarded and refuses to mint signatures.
  companyId: string;
  // PFL-102: verification's shapeUser() requires displayName — without it
  // the user resolves to null → USER_UNKNOWN at verify time.
  displayName?: string;
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

// PFL-067: legacy hackathon companyId. Kept ONLY as a sentinel so the
// existing-user path can detect docs that were stamped with it before
// domain-based linking landed and re-resolve them. Do NOT use as a
// fallback when creating new users — un-linked users get companyId: ""
// and needsOnboarding: true on the response.
const LEGACY_DEMO_COMPANY_ID = "dev-company";

// PFL-067: public email providers we never auto-link. A "yahoo.com"
// company sneaking into the registry would otherwise grab every Yahoo
// user the first time they install the extension. Keep this list narrow
// — real corporate domains shouldn't appear here.
const PUBLIC_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
  "zoho.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "duck.com",
  "tutanota.com",
]);

function extractEmailDomain(email: string | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain);
}

/**
 * Look up the company a user's email domain belongs to. Returns null
 * when the email is missing, the domain is a public provider, or no
 * company has registered that domain.
 */
export async function resolveCompanyIdByEmail(
  firestore: FirebaseFirestore.Firestore,
  email: string | undefined,
): Promise<string | null> {
  const domain = extractEmailDomain(email);
  if (!domain || isPublicEmailDomain(domain)) return null;

  const snap = await firestore
    .collection("companies")
    .where("domain", "==", domain)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data() as { companyId?: string };
  return data.companyId ?? snap.docs[0].id ?? null;
}

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

// ─── Display-name derivation (PFL-102) ───────────────────────────────────────

/**
 * Derive a human display name for a new/backfilled user doc.
 *   1. Firebase Auth display name (decoded.name) if present.
 *   2. Else the email local-part, split on `.`/`_`/`-`, each word
 *      capitalized: "daniel.ookoro@gmail.com" → "Daniel Ookoro".
 *   3. Else the raw email (last-ditch so the field is never empty).
 */
function deriveDisplayName(decoded: { name?: string; email?: string }): string {
  const name = decoded.name?.trim();
  if (name) return name;

  const email = decoded.email?.trim() ?? "";
  const localPart = email.split("@")[0] ?? "";
  if (localPart) {
    const words = localPart
      .split(/[._-]+/)
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (words.length > 0) return words.join(" ");
  }

  return email;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface ExtensionAuthHandlerDeps {
  /**
   * Verify a Firebase ID token. Defaults to firebase-admin/auth.
   * Injected for tests so we don't need a live Firebase project.
   */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string; name?: string }>;
}

export function makeExtensionAuthHandler(deps: ExtensionAuthHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email, name: decoded.name };
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
    let decoded: { uid: string; email?: string; name?: string };
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
      // PFL-102: backfill displayName for users created before this fix.
      // verification's shapeUser() returns null without it → USER_UNKNOWN.
      if (!user.displayName || user.displayName.trim().length === 0) {
        const displayName = deriveDisplayName({ name: decoded.name, email: user.email || decoded.email });
        user.displayName = displayName;
        await userRef.set({ displayName, updatedAt: Date.now() }, { merge: true });
      }
      // PFL-067: re-resolve companyId for users that were stamped with the
      // legacy DEMO sentinel (or got an empty companyId before this lookup
      // existed). Only writes when we find a real match — we never clobber
      // a real companyId an owner already set.
      const needsReresolve =
        !user.companyId ||
        user.companyId === LEGACY_DEMO_COMPANY_ID;
      if (needsReresolve) {
        const resolved = await resolveCompanyIdByEmail(firestore, user.email || decoded.email);
        if (resolved && resolved !== user.companyId) {
          user.companyId = resolved;
          await userRef.set(
            { companyId: resolved, updatedAt: Date.now() },
            { merge: true },
          );
        }
      }
    } else {
      const resolvedCompanyId = await resolveCompanyIdByEmail(firestore, decoded.email);
      const now = Date.now();
      user = {
        userId:        decoded.uid,
        email:         decoded.email ?? "",
        displayName:   deriveDisplayName({ name: decoded.name, email: decoded.email }),
        // PFL-067: empty string when no company matched. The signing path
        // gates on a non-empty companyId, so un-linked users can auth but
        // can't sign until they're invited / onboarded.
        companyId:     resolvedCompanyId ?? "",
        role:          DEFAULT_ROLE,
        // PFL-067: "pending" until the user is linked to a company. Once a
        // domain match exists we treat them as active immediately.
        status:        resolvedCompanyId ? DEFAULT_STATUS : "pending",
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
    // PFL-067: tell the popup the user has no company yet so it can
    // surface a "your company isn't on ProofLine yet" message instead of
    // letting them try (and silently fail) to sign.
    if (!user.companyId) {
      response.needsOnboarding = true;
    }
    res.status(200).json(response);
  };
}
