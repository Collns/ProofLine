/**
 * @file admin-auth.middleware.ts
 * @module apps/functions/src/auth
 *
 * PFL-127 — Firebase Auth Bearer middleware for the admin API.
 *
 * The admin dashboard (apps/web-admin) authenticates via Firebase Auth
 * (Google sign-in), NOT the extension JWS used by the sign popup. Every
 * /v1/admin/* GET runs through this middleware:
 *
 *   1. Read `Authorization: Bearer <firebaseIdToken>`.
 *   2. Verify with firebase-admin/auth.verifyIdToken().
 *   3. Look up `users/{uid}` in Firestore.
 *   4. Enforce `status === "active"` AND `role ∈ {owner, manager}` AND
 *      non-empty companyId.
 *   5. Set `req.adminUser = { userId, companyId, role, email }`.
 *
 * Optional `?cid=` override: for an owner caller, the middleware honors
 * `?cid=<otherCompanyId>` only if `companies/{cid}.ownerUserId` matches
 * the caller. Managers and employees can NEVER target another company —
 * the query param is ignored on those calls.
 *
 * Failure codes (all 401 except 403 for role/company gates):
 *   NO_AUTH_TOKEN            — missing/malformed Authorization header
 *   INVALID_TOKEN            — verifyIdToken threw
 *   NO_USER_RECORD (403)     — users/{uid} doesn't exist
 *   USER_INACTIVE (403)      — status !== "active"
 *   NO_COMPANY (403)         — companyId missing
 *   NOT_AUTHORIZED (403)     — role not owner/manager
 *   CROSS_COMPANY (403)      — ?cid= specified but caller doesn't own it
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface AdminUserClaims {
  userId:    string;
  companyId: string;
  role:      "owner" | "manager";
  email?:    string;
}

export type AdminAuthRequest = express.Request & { adminUser?: AdminUserClaims };

// ─── Middleware factory (deps injectable for tests) ──────────────────────────

export interface AdminAuthDeps {
  /** Defaults to firebase-admin/auth.verifyIdToken. Injected for tests. */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  /** Defaults to firebase-admin/firestore.getFirestore. Injected for tests. */
  getFirestore?: () => FirebaseFirestore.Firestore;
}

export function makeAdminAuth(deps: AdminAuthDeps = {}): express.RequestHandler {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const firestore = deps.getFirestore ?? getFirestore;

  return async function adminAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    // 1. Bearer auth.
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NO_AUTH_TOKEN",
          "NO_AUTH_TOKEN",
          401,
          "Missing or malformed Authorization header",
        ),
      );
      return;
    }
    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NO_AUTH_TOKEN",
          "NO_AUTH_TOKEN",
          401,
          "Bearer token is empty",
        ),
      );
      return;
    }

    let decoded: { uid: string; email?: string };
    try {
      decoded = await verifyIdToken(idToken);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "ID token verification failed";
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/INVALID_TOKEN",
          "INVALID_TOKEN",
          401,
          detail,
        ),
      );
      return;
    }

    // 2. Resolve users/{uid}.
    const db = firestore();
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NO_USER_RECORD",
          "NO_USER_RECORD",
          403,
          "Caller has no user record — onboard or accept an invitation first",
        ),
      );
      return;
    }
    const user = userSnap.data() as {
      companyId?: string;
      role?:      string;
      status?:    string;
      email?:     string;
    };

    if (!user.companyId) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NO_COMPANY",
          "NO_COMPANY",
          403,
          "Caller is not linked to a company",
        ),
      );
      return;
    }
    if (user.status && user.status !== "active") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/USER_INACTIVE",
          "USER_INACTIVE",
          403,
          `Caller is ${user.status}`,
        ),
      );
      return;
    }
    if (user.role !== "owner" && user.role !== "manager") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Only owners and managers can access the admin API",
        ),
      );
      return;
    }

    // 3. Optional ?cid= override — owners only, with ownership check.
    let resolvedCompanyId = user.companyId;
    const cidParam = typeof req.query["cid"] === "string"
      ? (req.query["cid"] as string).trim()
      : "";
    if (cidParam && cidParam !== user.companyId) {
      if (user.role !== "owner") {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/CROSS_COMPANY",
            "CROSS_COMPANY",
            403,
            "Only owners may target a different company via ?cid=",
          ),
        );
        return;
      }
      const companySnap = await db.collection("companies").doc(cidParam).get();
      if (!companySnap.exists) {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/CROSS_COMPANY",
            "CROSS_COMPANY",
            403,
            `Company ${cidParam} does not exist`,
          ),
        );
        return;
      }
      const company = companySnap.data() as { ownerUserId?: string };
      if (company.ownerUserId !== decoded.uid) {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/CROSS_COMPANY",
            "CROSS_COMPANY",
            403,
            `Caller does not own company ${cidParam}`,
          ),
        );
        return;
      }
      resolvedCompanyId = cidParam;
    }

    (req as AdminAuthRequest).adminUser = {
      userId:    decoded.uid,
      companyId: resolvedCompanyId,
      role:      user.role,
      ...(decoded.email ? { email: decoded.email } : {}),
    };
    next();
  };
}

/** Convenience default — used by index.ts when wiring routes. */
export const adminAuthMiddleware = makeAdminAuth();
