/**
 * @file update-role.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/update-role — PFL-128.
 *
 * Owner-only: change a teammate's `users/{uid}.role` between
 * `employee` and `manager`. Promoting to `owner` is intentionally
 * blocked here because owner transfer is a privileged workflow that
 * involves company-doc ownership (see companies/{cid}.ownerUserId) and
 * needs a dedicated audit trail.
 *
 * Auth: `Authorization: Bearer <firebaseIdToken>`.
 *
 * Rules:
 *   - Caller must have `role === "owner"` AND `status === "active"`.
 *   - Target must be in the caller's `companyId`.
 *   - Caller may not change their OWN role (refuse 403 SELF_CHANGE).
 *   - Target's new role must be in {employee, manager}.
 *
 * Storage: `users/{userId}.role` (string, also re-stamps `updatedAt`).
 * The change is mirrored to `audit_events` so an owner can later trace
 * who promoted whom.
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Request schema ──────────────────────────────────────────────────────────

const UpdateRoleBodySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role:   z.enum(["employee", "manager"], {
    errorMap: () => ({ message: "role must be employee or manager" }),
  }),
});

export interface UpdateRoleResponse {
  ok:        true;
  userId:    string;
  role:      "employee" | "manager";
  companyId: string;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface UpdateRoleHandlerDeps {
  /** Verify the Firebase ID token Bearer. Defaults to firebase-admin/auth. */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  /** Wall-clock; injected for tests. */
  now?: () => number;
}

export function makeUpdateRoleHandler(deps: UpdateRoleHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const now = deps.now ?? (() => Date.now());

  return async function updateRoleHandler(
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
    const parsed = UpdateRoleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { userId, role } = parsed.data;

    // 3. Self-change guard (cheap, before any DB reads).
    if (userId === caller.uid) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/SELF_CHANGE",
          "SELF_CHANGE",
          403,
          "Cannot change your own role",
        ),
      );
      return;
    }

    // 4. Resolve caller — must be an active owner.
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
    if (callerDoc.role !== "owner") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Only owners can change roles",
        ),
      );
      return;
    }

    // 5. Resolve target. 404 if missing, 403 if in a different company.
    //    A future-proofing note: even when the target's existing role is
    //    `owner`, refusing here is correct — owner demotion is a transfer
    //    flow, not a role edit.
    const targetRef  = firestore.collection("users").doc(userId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      res.status(404).json(ERR.notFound(`User ${userId} not found`));
      return;
    }
    const target = targetSnap.data() as { companyId?: string; role?: string };
    if (target.companyId !== callerDoc.companyId) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/CROSS_COMPANY",
          "CROSS_COMPANY",
          403,
          "Target user belongs to a different company",
        ),
      );
      return;
    }
    if (target.role === "owner") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/OWNER_TRANSFER_REQUIRED",
          "OWNER_TRANSFER_REQUIRED",
          403,
          "Demoting an owner requires a separate ownership-transfer flow",
        ),
      );
      return;
    }

    // 6. Apply update.
    const ts = now();
    await targetRef.set({ role, updatedAt: ts }, { merge: true });

    // 7. Audit (best-effort — never blocks the change).
    try {
      await firestore.collection("audit_events").add({
        type:        "ROLE_UPDATED",
        targetUserId: userId,
        actorUserId: caller.uid,
        companyId:   callerDoc.companyId,
        fromRole:    target.role ?? null,
        toRole:      role,
        createdAt:   ts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[update-role] audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const response: UpdateRoleResponse = {
      ok:        true,
      userId,
      role,
      companyId: callerDoc.companyId,
    };
    res.status(200).json(response);
  };
}
