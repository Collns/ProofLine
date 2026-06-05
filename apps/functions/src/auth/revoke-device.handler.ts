/**
 * @file revoke-device.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/revoke-device — PFL-085.
 *
 * Marks a specific WebAuthn credential on a user's `devices[]` array as
 * revoked. Sign-finalize and validatePolicy already short-circuit on
 * `device.revokedAt`, so a revoked device can no longer mint signatures.
 * We also walk `sessions` and revoke any active session bound to the
 * same `deviceCredentialId` so the silent-sign path can't ride past the
 * revocation either.
 *
 * Auth: Bearer JWS extension auth token (same shape as register-credential).
 *
 * Authorization:
 *   - Self-service: caller may revoke their own device.
 *   - Admin: owner/manager in the SAME company as the target user.
 *   - Anything else → 403 NOT_AUTHORIZED.
 *
 * Body:  { userId: string, credentialId: string }
 *
 * Returns:
 *   200 { ok, userId, credentialId, revokedAt, sessionsRevoked }
 *   401 if Bearer missing/invalid
 *   403 NOT_AUTHORIZED
 *   404 DEVICE_NOT_FOUND  (no such credentialId on user.devices[])
 *   404 USER_NOT_FOUND    (no users/{userId} doc)
 *   200 with revokedAt unchanged when the device is already revoked
 *       (idempotent — re-revoking is a no-op success)
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";
import { verifyExtensionAuthBearer } from "./require-extension-auth.middleware.js";

// ─── Request schema ──────────────────────────────────────────────────────────

const RevokeDeviceBodySchema = z.object({
  userId:       z.string().min(1, "userId is required"),
  credentialId: z.string().min(1, "credentialId is required"),
});

export interface RevokeDeviceResponse {
  ok:               true;
  userId:           string;
  credentialId:     string;
  revokedAt:        number;
  sessionsRevoked:  number;
}

// ─── Audit event ─────────────────────────────────────────────────────────────

interface DeviceRevocationAudit {
  type:         "DEVICE_REVOKED";
  userId:       string;
  credentialId: string;
  revokedBy:    string;
  revokedAt:    number;
  reason:       "admin_revoke" | "self_revoke";
  sessionsRevoked: number;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface RevokeDeviceHandlerDeps {
  /** Inject for tests; defaults to the shared HMAC bearer verifier. */
  verifyAuthorization?: typeof verifyExtensionAuthBearer;
  /** Wall-clock; inject for tests. */
  now?: () => number;
}

export function makeRevokeDeviceHandler(deps: RevokeDeviceHandlerDeps = {}) {
  const verifyAuthorization = deps.verifyAuthorization ?? verifyExtensionAuthBearer;
  const now                = deps.now                ?? (() => Date.now());

  return async function revokeDeviceHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Bearer auth.
    const authResult = verifyAuthorization(req.headers.authorization);
    if (!authResult.ok) {
      res.status(401).json(ERR.unauthorized(authResult.detail));
      return;
    }
    const callerId        = authResult.claims.userId;
    const callerCompanyId = authResult.claims.companyId;

    // 2. Body parse.
    const parsed = RevokeDeviceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { userId, credentialId } = parsed.data;

    // 3. Look up the target user.
    const firestore  = getFirestore();
    const targetRef  = firestore.collection("users").doc(userId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      res.status(404).json(
        makeRFC7807Error(
          "https://proofline.app/errors/USER_NOT_FOUND",
          "USER_NOT_FOUND",
          404,
          `No user ${userId}`,
        ),
      );
      return;
    }
    const target = targetSnap.data() as {
      companyId?: string;
      devices?:   Array<Record<string, unknown>>;
    };

    // 4. Authorization: self, OR owner/manager in the same company.
    const isSelf = callerId === userId;
    let reason: DeviceRevocationAudit["reason"] = "admin_revoke";

    if (isSelf) {
      reason = "self_revoke";
    } else {
      const callerSnap = await firestore.collection("users").doc(callerId).get();
      if (!callerSnap.exists) {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/NOT_AUTHORIZED",
            "NOT_AUTHORIZED",
            403,
            "Caller has no user record",
          ),
        );
        return;
      }
      const caller = callerSnap.data() as { role?: string; companyId?: string };
      const sameCompany =
        !!caller.companyId &&
        !!target.companyId &&
        caller.companyId === target.companyId &&
        caller.companyId === callerCompanyId;
      const isAdmin = caller.role === "owner" || caller.role === "manager";
      if (!sameCompany || !isAdmin) {
        res.status(403).json(
          makeRFC7807Error(
            "https://proofline.app/errors/NOT_AUTHORIZED",
            "NOT_AUTHORIZED",
            403,
            "Only the device owner, or an owner/manager in the same company, can revoke",
          ),
        );
        return;
      }
    }

    // 5. Find the device. 404 if not on this user.
    const devices = Array.isArray(target.devices) ? target.devices : [];
    const idx = devices.findIndex(
      (d) => (d as { credentialId?: string }).credentialId === credentialId,
    );
    if (idx < 0) {
      res.status(404).json(
        makeRFC7807Error(
          "https://proofline.app/errors/DEVICE_NOT_FOUND",
          "DEVICE_NOT_FOUND",
          404,
          `Device ${credentialId} not enrolled for user ${userId}`,
        ),
      );
      return;
    }

    // 6. Idempotent revoke: if already revoked, keep existing revokedAt.
    const existing = devices[idx] as { revokedAt?: number };
    const revokedAt = typeof existing.revokedAt === "number" ? existing.revokedAt : now();

    if (typeof existing.revokedAt !== "number") {
      const updatedDevices = devices.map((d, i) =>
        i === idx ? { ...d, revokedAt } : d,
      );
      await targetRef.set(
        { devices: updatedDevices, updatedAt: now() },
        { merge: true },
      );
    }

    // 7. Revoke sessions bound to this credentialId. We treat this as
    //    best-effort: a write failure here doesn't undo the device
    //    revocation. validatePolicy / sign-finalize will reject the
    //    silent path anyway because the device.revokedAt above is now
    //    set, so this loop just keeps the sessions collection tidy.
    let sessionsRevoked = 0;
    try {
      const sessionSnap = await firestore
        .collection("sessions")
        .where("userId", "==", userId)
        .where("deviceCredentialId", "==", credentialId)
        .where("status", "==", "active")
        .get();

      const batch = firestore.batch();
      for (const docSnap of sessionSnap.docs) {
        batch.set(
          docSnap.ref,
          {
            status:       "revoked",
            revokedAt:    now(),
            revokedBy:    callerId,
            revokeReason: "device_revoked",
          },
          { merge: true },
        );
        sessionsRevoked++;
      }
      if (sessionsRevoked > 0) await batch.commit();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[revoke-device] session sweep failed (device still revoked): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 8. Audit event — append to `audit_events` collection. Like the
    //    session sweep this is best-effort; the device revocation itself
    //    is the durable record.
    try {
      const audit: DeviceRevocationAudit = {
        type:         "DEVICE_REVOKED",
        userId,
        credentialId,
        revokedBy:    callerId,
        revokedAt,
        reason,
        sessionsRevoked,
      };
      await firestore.collection("audit_events").add({
        ...audit,
        createdAt: now(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[revoke-device] audit log failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const response: RevokeDeviceResponse = {
      ok:              true,
      userId,
      credentialId,
      revokedAt,
      sessionsRevoked,
    };
    res.status(200).json(response);
  };
}
