/**
 * @file firebase-auth.middleware.ts
 * @module apps/functions/src/auth
 *
 * PFL-166 — Firebase ID-token auth for the onboarding and bilateral
 * routes (replaces the old pass-through middleware that always set a fixed
 * development identity).
 *
 *   1. Read `Authorization: Bearer <firebaseIdToken>`.
 *   2. Verify it with firebase-admin/auth.verifyIdToken().
 *   3. `requireCompany: false` (onboarding): set
 *        req.user = { userId: uid, email }
 *      The caller may not have a users/{uid} doc yet; they are here to
 *      create a company.
 *   4. `requireCompany: true` (bilateral drafter routes): additionally load
 *      users/{uid}, require status "active" and a companyId, and set
 *        req.user = { userId, email, companyId, role }
 *
 * The identity always comes from the verified token (and the server-side
 * users doc), never from the request body, query string or headers other
 * than Authorization.
 *
 * Failure codes:
 *   401 NO_AUTH_TOKEN   — missing/malformed Authorization header
 *   401 INVALID_TOKEN   — verifyIdToken threw
 *   403 NO_USER_RECORD  — requireCompany and users/{uid} missing
 *   403 USER_INACTIVE   — requireCompany and status !== "active"
 *   403 NO_COMPANY      — requireCompany and companyId missing
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { makeRFC7807Error } from "../api/onboarding/http.helpers.js";

export interface AuthenticatedUser {
  userId:     string;
  email?:     string;
  companyId?: string;
  role?:      string;
}

export type AuthenticatedRequest = express.Request & { user?: AuthenticatedUser };

export interface FirebaseAuthDeps {
  /** Defaults to firebase-admin/auth.verifyIdToken. Injected for tests. */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  /** Defaults to firebase-admin/firestore.getFirestore. Injected for tests. */
  getFirestore?: () => FirebaseFirestore.Firestore;
}

export interface FirebaseAuthOptions {
  /** Require an active users/{uid} doc with a companyId. */
  requireCompany: boolean;
  /**
   * When true, a request with no Authorization header passes through with
   * req.user unset (handlers then require another credential, e.g. a
   * signed link token). A present-but-invalid token is still rejected.
   */
  optional?: boolean;
}

function problem(res: express.Response, status: number, code: string, detail: string): void {
  res.status(status).json(
    makeRFC7807Error(`https://proofline.app/errors/${code}`, code, status, detail),
  );
}

export function makeFirebaseAuth(
  options: FirebaseAuthOptions,
  deps: FirebaseAuthDeps = {},
): express.RequestHandler {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const firestore = deps.getFirestore ?? getFirestore;

  return async function firebaseAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    // Never trust an identity set upstream of this middleware.
    delete (req as AuthenticatedRequest).user;

    const header = typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";

    if (!header) {
      if (options.optional) {
        next();
        return;
      }
      problem(res, 401, "NO_AUTH_TOKEN", "Missing Authorization header");
      return;
    }
    if (!header.startsWith("Bearer ")) {
      problem(res, 401, "NO_AUTH_TOKEN", "Malformed Authorization header");
      return;
    }
    const idToken = header.slice("Bearer ".length).trim();
    if (!idToken) {
      problem(res, 401, "NO_AUTH_TOKEN", "Bearer token is empty");
      return;
    }

    let decoded: { uid: string; email?: string };
    try {
      decoded = await verifyIdToken(idToken);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "ID token verification failed";
      problem(res, 401, "INVALID_TOKEN", detail);
      return;
    }

    const user: AuthenticatedUser = { userId: decoded.uid };
    if (decoded.email) user.email = decoded.email;

    if (options.requireCompany) {
      try {
        const snap = await firestore().collection("users").doc(decoded.uid).get();
        if (!snap.exists) {
          problem(res, 403, "NO_USER_RECORD", "Caller has no user record");
          return;
        }
        const data = snap.data() as { companyId?: string; status?: string; role?: string };
        if (data.status && data.status !== "active") {
          problem(res, 403, "USER_INACTIVE", `Caller is ${data.status}`);
          return;
        }
        if (!data.companyId) {
          problem(res, 403, "NO_COMPANY", "Caller is not linked to a company");
          return;
        }
        user.companyId = data.companyId;
        if (data.role) user.role = data.role;
      } catch (err) {
        next(err);
        return;
      }
    }

    (req as AuthenticatedRequest).user = user;
    next();
  };
}
