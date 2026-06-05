/**
 * @file handlers.ts
 * @module apps/functions/src/api/admin
 *
 * PFL-127 — read-only admin API endpoints. Each handler relies on
 * `req.adminUser` already being populated by `adminAuthMiddleware`, so
 * authentication / authorization / company scoping is single-sourced
 * upstream. Handlers never accept a companyId from the request body or
 * query (the `?cid=` knob is owner-only and applied in the middleware).
 *
 * Endpoints:
 *   GET /v1/admin/company
 *   GET /v1/admin/users
 *   GET /v1/admin/signed-messages
 *   GET /v1/admin/sessions
 *   GET /v1/admin/invitations
 *
 * All responses are JSON. Errors use the RFC 7807 envelope from
 * ../onboarding/http.helpers. The dashboard expects empty arrays
 * (not 404) for "no data" — explicit notFound only on the company
 * profile endpoint, which is the one read that has a singular target.
 */

import type * as express from "express";

import { ERR } from "../onboarding/http.helpers.js";
import type { AdminAuthRequest, AdminUserClaims } from "../../auth/admin-auth.middleware.js";

// ─── Public response shapes ──────────────────────────────────────────────────
//
// Mirrors apps/web-admin/src/lib/admin-data.ts so the client typings
// can be derived from these. Keep field names in sync — the rewired
// admin-data.ts depends on them.

export interface AdminCompanyResponse {
  companyId:         string;
  legalName:         string;
  domain:            string;
  ein:               string | null;
  status:            string;
  onboardingStatus:  string | null;
  rootPublicKey:     string | null;  // truncated server-side
  kmsKeyName:        string | null;
  createdAt:         number | null;
  verifiedAt:        number | null;
  anchorTxHash:      string | null;
  anchorBlockNumber: number | null;
}

export interface AdminDeviceResponse {
  credentialId: string;
  deviceName:   string | null;
  enrolledAt:   number | null;
  lastUsedAt:   number | null;
  revokedAt:    number | null;
}

export interface AdminUserResponse {
  userId:      string;
  email:       string;
  displayName: string;
  role:        string;
  status:      string;
  devices:     AdminDeviceResponse[];
  createdAt:   number | null;
}

export interface AdminSignatureResponse {
  signerId:     string;
  credentialId: string;
  signedAt:     number | null;
}

export interface AdminSignedMessageResponse {
  messageId:         string;
  from:              string;
  to:                string[];
  subject:           string;
  isWireInstruction: boolean;
  status:            string;
  createdAt:         number | null;
  anchorTxHash:      string | null;
  anchorBlockNumber: number | null;
  signatures:        AdminSignatureResponse[];
}

export interface AdminSessionResponse {
  sessionId:          string;
  userId:             string;
  recipientScope:     string;
  primaryRecipient:   string;
  deviceCredentialId: string;
  authorizedAt:       number | null;
  expiresAt:          number | null;
  lastUsedAt:         number | null;
  signCount:          number | null;
}

export interface AdminInvitationResponse {
  invitationId: string;
  email:        string;
  role:         string;
  status:       string;
  invitedBy:    string;
  createdAt:    number | null;
  expiresAt:    number | null;
  acceptedAt:   number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function truncatePublicKey(spkiBase64: string | null): string | null {
  if (!spkiBase64) return null;
  if (spkiBase64.length <= 32) return spkiBase64;
  return `${spkiBase64.slice(0, 16)}…${spkiBase64.slice(-12)}`;
}

function adminUser(req: express.Request): AdminUserClaims {
  const claims = (req as AdminAuthRequest).adminUser;
  if (!claims) {
    // This should never happen — the middleware is mounted upstream.
    // Throwing surfaces a 500 instead of a silent empty response that
    // would let an unauthed caller pass through to the data.
    throw new Error("adminUser missing on request — middleware not mounted?");
  }
  return claims;
}

// ─── Handler factories ───────────────────────────────────────────────────────

export interface AdminHandlersDeps {
  getFirestore: () => FirebaseFirestore.Firestore;
}

/**
 * GET /v1/admin/company — returns the caller's company profile (or the
 * ?cid=-overridden owner-target). 404 only when the company doc was
 * deleted out from under a live user record.
 */
export function makeCompanyHandler(deps: AdminHandlersDeps) {
  return async function companyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { companyId } = adminUser(req);
    const snap = await deps.getFirestore().collection("companies").doc(companyId).get();
    if (!snap.exists) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }
    const d = snap.data() ?? {};
    const response: AdminCompanyResponse = {
      companyId,
      legalName:         str(d.legalName, "(unnamed company)"),
      domain:            str(d.domain),
      ein:               strOrNull(d.ein),
      status:            str(d.status) || str(d.onboardingStatus, "unknown"),
      onboardingStatus:  strOrNull(d.onboardingStatus),
      rootPublicKey:     truncatePublicKey(strOrNull(d.rootPublicKey)),
      kmsKeyName:        strOrNull(d.kmsKeyName),
      createdAt:         num(d.createdAt),
      verifiedAt:        num(d.verifiedAt),
      anchorTxHash:      strOrNull(d.anchorTxHash),
      anchorBlockNumber: num(d.anchorBlockNumber),
    };
    res.status(200).json(response);
  };
}

/**
 * GET /v1/admin/users — users where companyId == caller's company.
 * Sorted by role (owner → manager → employee) then createdAt asc so
 * the dashboard's user list reads top-down for org structure.
 */
const ROLE_ORDER: Record<string, number> = {
  owner:    0,
  manager:  1,
  employee: 2,
};

export function makeUsersHandler(deps: AdminHandlersDeps) {
  return async function usersHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { companyId } = adminUser(req);
    const snap = await deps.getFirestore()
      .collection("users")
      .where("companyId", "==", companyId)
      .get();

    const users: AdminUserResponse[] = snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      const rawDevices = Array.isArray(d["devices"]) ? (d["devices"] as Record<string, unknown>[]) : [];
      return {
        userId:      docSnap.id,
        email:       str(d["email"]),
        displayName: str(d["displayName"]) || docSnap.id,
        role:        str(d["role"], "unknown"),
        status:      str(d["status"], "unknown"),
        devices:     rawDevices.map((dev) => ({
          credentialId: str(dev["credentialId"]),
          deviceName:   strOrNull(dev["deviceName"]),
          enrolledAt:   num(dev["enrolledAt"]),
          lastUsedAt:   num(dev["lastUsedAt"]),
          revokedAt:    num(dev["revokedAt"]),
        })),
        createdAt:   num(d["createdAt"]),
      };
    });

    users.sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });

    res.status(200).json({ users });
  };
}

/**
 * GET /v1/admin/signed-messages — recent 50 envelopes for the caller's
 * company, newest first. `companyId` on `signed_messages` is inside
 * `payload.companyId` historically; we fetch with an over-pull + filter
 * client-side to avoid requiring a composite index. 50-row cap keeps
 * the over-pull bounded.
 */
const SIGNED_MESSAGES_LIMIT = 50;
const SIGNED_MESSAGES_OVERPULL = 200;

export function makeSignedMessagesHandler(deps: AdminHandlersDeps) {
  return async function signedMessagesHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { companyId } = adminUser(req);
    const snap = await deps.getFirestore()
      .collection("signed_messages")
      .orderBy("createdAt", "desc")
      .limit(SIGNED_MESSAGES_OVERPULL)
      .get();

    const out: AdminSignedMessageResponse[] = [];
    for (const docSnap of snap.docs) {
      const d = docSnap.data() as Record<string, unknown>;
      const payload = (d["payload"] ?? {}) as Record<string, unknown>;
      const docCompanyId = str(payload["companyId"]) || str(d["companyId"]);
      if (docCompanyId && docCompanyId !== companyId) continue;

      const sigs = Array.isArray(d["signatures"]) ? (d["signatures"] as Record<string, unknown>[]) : [];
      const signatures: AdminSignatureResponse[] = sigs.map((s) => ({
        signerId:     str(s["signerId"]),
        credentialId: str(s["credentialId"]),
        signedAt:     num(s["signedAt"]),
      }));
      out.push({
        messageId:         docSnap.id,
        from:              str(payload["from"]),
        to:                Array.isArray(payload["to"]) ? (payload["to"] as unknown[]).map(String) : [],
        subject:           str(payload["subject"]) || "(no subject)",
        isWireInstruction: payload["isWireInstruction"] === true,
        status:            str(d["status"], "SIGNED"),
        createdAt:         num(d["createdAt"]),
        anchorTxHash:      strOrNull(d["anchorTxHash"]),
        anchorBlockNumber: num(d["anchorBlockNumber"]),
        signatures,
      });
      if (out.length >= SIGNED_MESSAGES_LIMIT) break;
    }
    res.status(200).json({ messages: out });
  };
}

/**
 * GET /v1/admin/sessions — active sessions for the caller's company.
 * Strict company filter (sessions are written with companyId set at
 * createSession time; no legacy "no companyId" rows are expected here).
 */
export function makeSessionsHandler(deps: AdminHandlersDeps) {
  return async function sessionsHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { companyId } = adminUser(req);
    const snap = await deps.getFirestore()
      .collection("sessions")
      .where("companyId", "==", companyId)
      .where("status", "==", "active")
      .get();

    const sessions: AdminSessionResponse[] = snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      const recipients = Array.isArray(d["recipientAddresses"])
        ? (d["recipientAddresses"] as unknown[]).map(String)
        : [];
      return {
        sessionId:          docSnap.id,
        userId:             str(d["userId"]),
        recipientScope:     str(d["recipientSetHash"]),
        primaryRecipient:   recipients[0] ?? "",
        deviceCredentialId: str(d["deviceCredentialId"]),
        authorizedAt:       num(d["authorizedAt"]),
        expiresAt:          num(d["expiresAt"]),
        lastUsedAt:         num(d["lastUsedAt"]),
        signCount:          num(d["signCount"]),
      };
    });

    // Most-recently-authorized first.
    sessions.sort((a, b) => (b.authorizedAt ?? 0) - (a.authorizedAt ?? 0));

    res.status(200).json({ sessions });
  };
}

/**
 * GET /v1/admin/invitations — all invitations issued by the caller's
 * company (pending + accepted + revoked + expired). Newest first.
 */
export function makeInvitationsHandler(deps: AdminHandlersDeps) {
  return async function invitationsHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { companyId } = adminUser(req);
    const snap = await deps.getFirestore()
      .collection("employee_invitations")
      .where("companyId", "==", companyId)
      .get();

    const invitations: AdminInvitationResponse[] = snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        invitationId: docSnap.id,
        email:        str(d["email"]),
        role:         str(d["role"], "employee"),
        status:       str(d["status"], "unknown"),
        invitedBy:    str(d["invitedBy"]),
        createdAt:    num(d["createdAt"]),
        expiresAt:    num(d["expiresAt"]),
        acceptedAt:   num(d["acceptedAt"]),
      };
    });

    invitations.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    res.status(200).json({ invitations });
  };
}
