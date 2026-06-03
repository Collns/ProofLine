/**
 * @file invite-employee.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/invite-employee — owner/manager invites a teammate
 * to join their company on ProofLine (PFL-068).
 *
 * Why this exists: PFL-067 added domain-based company linking, but
 * personal-domain hires (sarah@gmail.com working at Acme Title) never
 * match by domain. This endpoint stores a pending invitation keyed by
 * the invitee's email; the extension auth handler consumes it on the
 * invitee's first sign-in and links them to the company with the
 * invited role.
 *
 * Auth: Firebase ID token Bearer (same shape as /v1/extension/auth but
 * via Authorization header). The caller's `users/{uid}` doc must have
 * `role` of "owner" or "manager" AND a non-empty `companyId` — that's
 * the company the invitation gets scoped to.
 *
 * Storage (employee_invitations/{invitationId}):
 *   {
 *     invitationId, email (lowercased), companyId,
 *     role: "employee" | "manager",
 *     invitedBy: string (uid),
 *     status: "pending" | "accepted" | "revoked" | "expired",
 *     createdAt, expiresAt   // 30 days
 *   }
 *
 * Server-only — clients have no read/write access via security rules.
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ERR } from "../api/onboarding/http.helpers.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** 30 days, per PFL-068. */
export const EMPLOYEE_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const EMPLOYEE_INVITATIONS_COLLECTION = "employee_invitations" as const;

// ─── Request / response shapes ───────────────────────────────────────────────

const InviteEmployeeRequestSchema = z.object({
  email: z.string().email("email must be a valid address"),
  role:  z.enum(["employee", "manager"]),
});

export interface InviteEmployeeResponse {
  ok:           true;
  invitationId: string;
  email:        string;
  companyId:    string;
  role:         "employee" | "manager";
  expiresAt:    number;
}

// ─── Persisted invitation record ─────────────────────────────────────────────

export type EmployeeInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface EmployeeInvitation {
  invitationId: string;
  email:        string;      // lowercased
  companyId:    string;
  role:         "employee" | "manager";
  invitedBy:    string;
  status:       EmployeeInvitationStatus;
  createdAt:    number;
  expiresAt:    number;
  acceptedAt?:  number;
  acceptedByUserId?: string;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface InviteEmployeeHandlerDeps {
  /** Verify the Firebase ID token Bearer. Injected for tests. */
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  /** Wall-clock; injected so tests can pin expiresAt. */
  now?:           () => number;
  /** uuid generator; injected so tests can pin invitationId. */
  newId?:         () => string;
}

export function makeInviteEmployeeHandler(deps: InviteEmployeeHandlerDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const now   = deps.now   ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());

  return async function inviteEmployeeHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Bearer auth — Firebase ID token.
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
    const parsed = InviteEmployeeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const inviteeEmail = parsed.data.email.trim().toLowerCase();
    const role         = parsed.data.role;

    // 3. Authorization — the caller must be an owner/manager of a real
    //    company. We resolve from the persisted users/{uid} doc, NOT from
    //    the request body, so a client can't claim authority they don't
    //    have.
    const firestore = getFirestore();
    const callerSnap = await firestore.collection("users").doc(caller.uid).get();
    if (!callerSnap.exists) {
      res.status(403).json(ERR.forbidden("Caller has no user record"));
      return;
    }
    const callerDoc = callerSnap.data() as {
      companyId?: string;
      role?:      string;
      status?:    string;
    };

    if (!callerDoc.companyId) {
      res.status(403).json(ERR.forbidden("Caller is not linked to a company"));
      return;
    }
    if (callerDoc.role !== "owner" && callerDoc.role !== "manager") {
      res.status(403).json(ERR.forbidden("Only owners and managers can invite employees"));
      return;
    }
    if (callerDoc.status && callerDoc.status !== "active") {
      res.status(403).json(ERR.forbidden(`Caller is ${callerDoc.status}`));
      return;
    }

    // 4. Reject duplicates — a pending invitation for the same email +
    //    company would race the extension auth path. Re-issuing instead
    //    of erroring is tempting, but it loses audit trail (who invited
    //    when), so we 409 and let the admin revoke + reissue explicitly.
    const dupSnap = await firestore
      .collection(EMPLOYEE_INVITATIONS_COLLECTION)
      .where("email", "==", inviteeEmail)
      .where("companyId", "==", callerDoc.companyId)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      res.status(409).json(
        ERR.conflict(
          "EMPLOYEE_INVITATION_PENDING",
          `A pending invitation already exists for ${inviteeEmail}`,
        ),
      );
      return;
    }

    // 5. Persist.
    const issuedAt    = now();
    const expiresAt   = issuedAt + EMPLOYEE_INVITATION_TTL_MS;
    const invitationId = newId();
    const record: EmployeeInvitation = {
      invitationId,
      email:     inviteeEmail,
      companyId: callerDoc.companyId,
      role,
      invitedBy: caller.uid,
      status:    "pending",
      createdAt: issuedAt,
      expiresAt,
    };

    await firestore
      .collection(EMPLOYEE_INVITATIONS_COLLECTION)
      .doc(invitationId)
      .set(record);

    const response: InviteEmployeeResponse = {
      ok:           true,
      invitationId,
      email:        inviteeEmail,
      companyId:    callerDoc.companyId,
      role,
      expiresAt,
    };
    res.status(200).json(response);
  };
}
