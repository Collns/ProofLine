/**
 * @file cosign-refresh.handler.ts
 * @module apps/functions/src/cosign
 *
 * POST /v1/cosign/:messageId/refresh  (PFL-062)
 *
 * Body: { token: <expired-or-soon-to-expire JWS> }
 *
 * Re-mints a JWS for the same messageId + payloadHash with a fresh
 * expiry and emails the link to the internal approvers stored on the
 * message (PFL-160). The original token may already be expired — we only need
 * its claims to seed the new one, so the decode reason of "EXPIRED" is
 * acceptable. Malformed tokens are rejected.
 *
 * TODO(PFL-COSIGN-RATELIMIT): cap refresh attempts per messageId per
 * hour to prevent abuse. Today we log and accept.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import {
  decodeCosignJws,
  mintCosignJws,
  type CosignClaims,
} from "./cosign.helpers.js";
import type { RefreshLinkResponse } from "./cosign.types.js";

// 30-minute refresh window matches what the counterparty UI tells users
// they'll have after clicking "Send a fresh link".
const REFRESH_TTL_SEC = 30 * 60;

const RefreshBodySchema = z.object({
  token: z.string().min(1, "token is required"),
});

// Lightweight decode that tolerates expired tokens so we can refresh
// them. Mirrors decodeCosignJws but skips the exp check.
function decodeForRefresh(
  token: string,
): { ok: true; claims: CosignClaims } | { ok: false; detail: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, detail: "Token is not a valid JWS" };
  }
  try {
    const payloadB64 = parts[1] as string;
    const raw = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof raw["iss"]         !== "string" ||
      typeof raw["sub"]         !== "string" ||
      typeof raw["payloadHash"] !== "string"
    ) {
      return { ok: false, detail: "Token is missing required claims" };
    }
    return {
      ok: true,
      claims: {
        iss:         raw["iss"]         as string,
        sub:         raw["sub"]         as string,
        payloadHash: raw["payloadHash"] as string,
        iat:         typeof raw["iat"] === "number" ? (raw["iat"] as number) : 0,
        exp:         typeof raw["exp"] === "number" ? (raw["exp"] as number) : 0,
        ...(typeof raw["kid"] === "string" ? { kid: raw["kid"] as string } : {}),
      },
    };
  } catch {
    return { ok: false, detail: "Token payload could not be decoded" };
  }
}

export interface CosignRefreshEmail {
  /** Internal approvers stored on the message (never the wire's external recipients). */
  to:         string[];
  messageId:  string;
  freshToken: string;
  expiresAt:  number;
  /** Full cosign link for the approver. */
  link:       string;
  wire: {
    amountUsd:             number;
    recipientAccountLast4: string;
    routingNumber:         string;
    memo?:                 string;
  } | null;
}

export interface CosignRefreshHandlerDeps {
  /**
   * Sends the fresh cosign link (PFL-160: wired to the configured email
   * provider in index.ts). Without it, no email is sent and the response
   * reports freshLinkSent: false — links are never written to the log.
   */
  sendFreshLinkEmail?: (input: CosignRefreshEmail) => Promise<void>;
  /** Base URL of the cosign portal (web-counterparty). */
  portalBaseUrl?: string;
}

const DEFAULT_PORTAL_BASE_URL = "https://proofline-counterparty.web.app";

function wireSummaryFrom(payload: Record<string, unknown> | undefined): CosignRefreshEmail["wire"] {
  if (!payload) return null;
  // Stored payload is either a wire payload or an email payload carrying one.
  const wire = (payload["wirePayload"] as Record<string, unknown> | undefined)
    ?? (typeof payload["recipientRouting"] === "string" ? payload : undefined);
  if (!wire) return null;
  const account = String(wire["recipientAccount"] ?? "");
  return {
    amountUsd:             Number(wire["amount"] ?? 0),
    recipientAccountLast4: account.slice(-4),
    routingNumber:         String(wire["recipientRouting"] ?? ""),
    ...(typeof wire["memo"] === "string" ? { memo: wire["memo"] as string } : {}),
  };
}

export function makeCosignRefreshHandler(deps: CosignRefreshHandlerDeps = {}) {
  const sendEmail = deps.sendFreshLinkEmail;
  const portalBaseUrl = (deps.portalBaseUrl ?? DEFAULT_PORTAL_BASE_URL).replace(/\/+$/, "");

  return async function cosignRefreshHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const messageId = req.params["messageId"];
    if (typeof messageId !== "string" || messageId.length === 0) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "messageId is required",
      });
      return;
    }

    const parsedBody = RefreshBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: parsedBody.error.message,
      });
      return;
    }

    const decoded = decodeForRefresh(parsedBody.data.token);
    if (!decoded.ok) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: decoded.detail,
      });
      return;
    }

    if (decoded.claims.sub !== messageId) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "Token subject does not match messageId",
      });
      return;
    }

    const firestore = getFirestore();

    // Make sure the message still exists and is still awaiting a cosigner.
    const messageSnap = await firestore.collection("signed_messages").doc(messageId).get();
    if (!messageSnap.exists) {
      respond(res, 404, {
        ok:     false,
        code:   "NOT_FOUND",
        detail: "Signed message not found",
      });
      return;
    }
    const stored = messageSnap.data() as Record<string, unknown>;
    const signers = (stored["signers"] as unknown[] | undefined)
                 ?? (stored["signatures"] as unknown[] | undefined)
                 ?? [];
    if (signers.length > 1) {
      respond(res, 200, {
        ok:     false,
        code:   "ALREADY_COSIGNED",
        detail: "This wire has already been cosigned. No refresh needed.",
      });
      return;
    }

    // Mint a fresh JWS with extended exp.
    const nowSec = Math.floor(Date.now() / 1000);
    const freshClaims: CosignClaims = {
      iss:         decoded.claims.iss,
      sub:         decoded.claims.sub,
      payloadHash: decoded.claims.payloadHash,
      iat:         nowSec,
      exp:         nowSec + REFRESH_TTL_SEC,
      ...(decoded.claims.kid ? { kid: decoded.claims.kid } : {}),
    };
    const freshToken = mintCosignJws(freshClaims);

    // PFL-160: the fresh link goes only to the internal approvers recorded on
    // the message (cosign.approverEmails). It is never sent to the wire's
    // external recipients and never written to the log.
    const cosign = stored["cosign"] as { approverEmails?: unknown } | undefined;
    const approvers = Array.isArray(cosign?.approverEmails)
      ? (cosign!.approverEmails as unknown[]).filter((e): e is string => typeof e === "string" && e.includes("@"))
      : [];

    let freshLinkSent = false;
    if (!sendEmail) {
      console.warn(`[cosign-refresh] no email sender configured; fresh link for ${messageId} not sent`);
    } else if (approvers.length === 0) {
      console.warn(`[cosign-refresh] no approver emails stored for ${messageId}; fresh link not sent`);
    } else {
      try {
        await sendEmail({
          to:         approvers,
          messageId,
          freshToken,
          expiresAt:  freshClaims.exp,
          link:       `${portalBaseUrl}/cosign/${encodeURIComponent(messageId)}?t=${encodeURIComponent(freshToken)}`,
          wire:       wireSummaryFrom(stored["payload"] as Record<string, unknown> | undefined),
        });
        freshLinkSent = true;
      } catch (err) {
        console.error(`[cosign-refresh] sending the fresh link failed for ${messageId}`, err instanceof Error ? err.message : err);
      }
    }

    respond(res, 200, {
      ok: true,
      freshLinkSent,
    });
  };
}

function respond(
  res: express.Response,
  status: number,
  body: RefreshLinkResponse,
): void {
  res.status(status).json(body);
}
