/**
 * @file update-status.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/update-status — PFL-128.
 *
 * Flip a teammate's `users/{uid}.status` between `active` and
 * `inactive`. On deactivation we cascade:
 *   - Every active session bound to the target user gets
 *     status="revoked" + revokedAt + revokeReason="user_deactivated".
 *   - Every entry in `users/{uid}.devices[]` gets a `revokedAt` stamp
 *     (so sign-finalize's DEVICE_REVOKED branch fires the next time
 *     this user tries to sign — defense-in-depth on top of the user
 *     status check).
 *
 * Reactivating an already-revoked user does NOT un-revoke their
 * devices or sessions — they'll need to re-enroll. That keeps the
 * "lost device → deactivate" recovery story honest.
 *
 * Auth: `Authorization: Bearer <firebaseIdToken>`.
 *
 * Authorization matrix:
 *   - caller === target              → 403 SELF_CHANGE
 *   - caller.company !== target.co.  → 403 CROSS_COMPANY
 *   - target.role === "owner"        → 403 NOT_AUTHORIZED
 *                                      (owner deactivation is a separate flow)
 *   - caller.role === "owner"        → can flip any non-owner
 *   - caller.role === "manager"      → can flip only employees
 *                                      (manager-on-manager → 403 NOT_AUTHORIZED)
 *   - else                           → 403 NOT_AUTHORIZED
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Request schema ──────────────────────────────────────────────────────────

const UpdateStatusBodySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  status: z.enum(["active", "inactive"], {
    errorMap: () => ({ message: "status must be active or inactive" }),
  }),
});

export interface UpdateStatusResponse {
  ok:               true;
  userId:           string;
  status:           "active" | "inactive";
  sessionsRevoked:  number;
  devicesRevoked:   number;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface UpdateStatusHandlerDeps {
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  now?: () => number;
}

export function makeUpdateStatusHandler(deps: UpdateStatusHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const now = deps.now ?? (() => Date.now());

  return async function updateStatusHandler(
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
    const parsed = UpdateStatusBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { userId, status } = parsed.data;

    if (userId === caller.uid) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/SELF_CHANGE",
          "SELF_CHANGE",
          403,
          "Cannot change your own status",
        ),
      );
      return;
    }

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
          "Only owners and managers can change user status",
        ),
      );
      return;
    }

    // 4. Resolve target.
    const targetRef  = firestore.collection("users").doc(userId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      res.status(404).json(ERR.notFound(`User ${userId} not found`));
      return;
    }
    const target = targetSnap.data() as {
      companyId?: string;
      role?:      string;
      devices?:   Array<Record<string, unknown>>;
    };
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
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Owners cannot be deactivated via this endpoint",
        ),
      );
      return;
    }
    if (callerDoc.role === "manager" && target.role !== "employee") {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Managers can only deactivate or reactivate employees",
        ),
      );
      return;
    }

    // 5. Apply user-level status.
    const ts = now();
    await targetRef.set({ status, updatedAt: ts }, { merge: true });

    // 6. On deactivation, cascade: revoke sessions + stamp device.revokedAt.
    //    Both are best-effort — failure here doesn't roll back the user
    //    flip, because sign-finalize / validatePolicy already gate on
    //    user.status === "active" (defense in depth).
    let sessionsRevoked = 0;
    let devicesRevoked  = 0;

    if (status === "inactive") {
      // 6a. Sessions: where userId == target AND status == active.
      try {
        const sessionSnap = await firestore
          .collection("sessions")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .get();
        const batch = firestore.batch();
        for (const docSnap of sessionSnap.docs) {
          batch.set(
            docSnap.ref,
            {
              status:       "revoked",
              revokedAt:    ts,
              revokedBy:    caller.uid,
              revokeReason: "user_deactivated",
            },
            { merge: true },
          );
          sessionsRevoked++;
        }
        if (sessionsRevoked > 0) await batch.commit();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[update-status] session sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // 6b. Devices: stamp revokedAt on every entry that's not already
      //     revoked. We do this inline so the same `target` doc only
      //     gets one write.
      const devices = Array.isArray(target.devices) ? target.devices : [];
      if (devices.length > 0) {
        const updatedDevices = devices.map((d) => {
          const dev = d as Record<string, unknown>;
          if (typeof dev.revokedAt === "number") return dev;
          devicesRevoked++;
          return { ...dev, revokedAt: ts };
        });
        if (devicesRevoked > 0) {
          await targetRef.set(
            { devices: updatedDevices, updatedAt: ts },
            { merge: true },
          );
        }
      }
    }

    // 7. Audit.
    try {
      await firestore.collection("audit_events").add({
        type:           "USER_STATUS_UPDATED",
        targetUserId:   userId,
        actorUserId:    caller.uid,
        companyId:      callerDoc.companyId,
        status,
        sessionsRevoked,
        devicesRevoked,
        createdAt:      ts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[update-status] audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const response: UpdateStatusResponse = {
      ok:              true,
      userId,
      status,
      sessionsRevoked,
      devicesRevoked,
    };
    res.status(200).json(response);
  };
}
