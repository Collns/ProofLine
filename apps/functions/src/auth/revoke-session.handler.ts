/**
 * @file revoke-session.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/revoke-session — PFL-130.
 *
 * Kill a single active signing session immediately. The session doc
 * gets status="revoked" + revokedAt/revokedBy/revokeReason, which the
 * sign-silent path already honours (SESSION_REVOKED), so the very next
 * silent sign on that session fails.
 *
 * Auth: `Authorization: Bearer <firebaseIdToken>` — same self-verified
 * pattern as update-status/update-role (not the GET-only
 * adminAuthMiddleware), so this handler keeps its own audit shape.
 *
 * Authorization matrix:
 *   - session.companyId !== caller.companyId → 403 CROSS_COMPANY
 *   - caller.role === "owner"                → any session in company
 *   - caller.role === "manager"              → own sessions, or sessions
 *                                              of employees (not owner/
 *                                              other managers)
 *   - else                                   → 403 NOT_AUTHORIZED
 *   - session.status !== "active"            → 409 SESSION_NOT_ACTIVE
 *     (already revoked/expired — nothing to do, and surfacing the
 *     conflict beats silently "succeeding" on a stale row)
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Request schema ──────────────────────────────────────────────────────────

const RevokeSessionBodySchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
});

export interface RevokeSessionResponse {
  ok:        true;
  sessionId: string;
  revokedAt: number;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface RevokeSessionHandlerDeps {
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  now?: () => number;
}

export function makeRevokeSessionHandler(deps: RevokeSessionHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const now = deps.now ?? (() => Date.now());

  return async function revokeSessionHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Bearer auth.
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json(ERR.unauthorized("Missing or malformed Authorization header"));
      return;
    }
    const idToken = authHeader.slice("Bearer ".length).trim();
    let caller: { uid: string; email?: string };
    try {
      caller = await verifyIdToken(idToken);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "ID token verification failed";
      res.status(401).json(ERR.unauthorized(detail));
      return;
    }

    // 2. Body parse.
    const parsed = RevokeSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { sessionId } = parsed.data;

    // 3. Resolve caller.
    const firestore = getFirestore();
    const callerSnap = await firestore.collection("users").doc(caller.uid).get();
    if (!callerSnap.exists) {
      res.status(403).json(ERR.forbidden("Caller has no user record"));
      return;
    }
    const callerDoc = callerSnap.data() as { companyId?: string; role?: string; status?: string };
    if (!callerDoc.companyId) {
      res.status(403).json(ERR.forbidden("Caller is not linked to a company"));
      return;
    }
    if (callerDoc.status && callerDoc.status !== "active") {
      res.status(403).json(ERR.forbidden(`Caller is ${callerDoc.status}`));
      return;
    }
    if (callerDoc.role !== "owner" && callerDoc.role !== "manager") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Only owners and managers can revoke sessions",
        ),
      );
      return;
    }

    // 4. Resolve target session.
    const sessionRef  = firestore.collection("sessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      res.status(404).json(ERR.notFound(`Session ${sessionId} not found`));
      return;
    }
    const session = sessionSnap.data() as {
      userId?:    string;
      companyId?: string;
      status?:    string;
    };
    if (session.companyId !== callerDoc.companyId) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/CROSS_COMPANY",
          "CROSS_COMPANY",
          403,
          "Session belongs to a different company",
        ),
      );
      return;
    }

    // Managers can kill their own sessions or those of employees; only
    // owners can kill owner/manager sessions.
    if (callerDoc.role === "manager" && session.userId !== caller.uid) {
      const targetUid  = session.userId ?? "";
      const targetSnap = targetUid
        ? await firestore.collection("users").doc(targetUid).get()
        : null;
      const targetRole = targetSnap?.exists
        ? (targetSnap.data() as { role?: string }).role
        : undefined;
      if (targetRole !== "employee") {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/NOT_AUTHORIZED",
            "NOT_AUTHORIZED",
            403,
            "Managers can only revoke their own sessions or employees' sessions",
          ),
        );
        return;
      }
    }

    if (session.status !== "active") {
      res.status(409).json(
        makeRFC7807Error(
          "https://proofline.app/errors/SESSION_NOT_ACTIVE",
          "SESSION_NOT_ACTIVE",
          409,
          `Session is ${session.status ?? "in an unknown state"}, not active`,
        ),
      );
      return;
    }

    // 5. Revoke.
    const ts = now();
    await sessionRef.set(
      {
        status:       "revoked",
        revokedAt:    ts,
        revokedBy:    caller.uid,
        revokeReason: "admin_manual",
      },
      { merge: true },
    );

    // 6. Audit — best-effort, same as update-status.
    try {
      await firestore.collection("audit_events").add({
        type:          "SESSION_REVOKED",
        sessionId,
        targetUserId:  session.userId ?? null,
        actorUserId:   caller.uid,
        companyId:     callerDoc.companyId,
        reason:        "admin_manual",
        createdAt:     ts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[revoke-session] audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const response: RevokeSessionResponse = { ok: true, sessionId, revokedAt: ts };
    res.status(200).json(response);
  };
}
