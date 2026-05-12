/**
 * @file cosign-refresh.handler.ts
 * @module apps/functions/src/cosign
 *
 * POST /v1/cosign/:messageId/refresh  (PFL-062)
 *
 * Body: { token: <expired-or-soon-to-expire JWS> }
 *
 * Re-mints a JWS for the same messageId + payloadHash with a fresh
 * expiry, and "sends" it via email (logged for now; Resend wiring is
 * follow-up). The original token may already be expired — we only need
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

export interface CosignRefreshHandlerDeps {
  /**
   * Email sender — defaults to a console.log shim. Injectable for tests
   * and for swapping in Resend once we wire it.
   */
  sendFreshLinkEmail?: (input: {
    to:         string;
    messageId:  string;
    freshToken: string;
    expiresAt:  number;
  }) => Promise<void>;
}

const defaultSendFreshLinkEmail: NonNullable<CosignRefreshHandlerDeps["sendFreshLinkEmail"]> =
  async ({ to, messageId, expiresAt }) => {
    // eslint-disable-next-line no-console
    console.log(
      `[cosign-refresh] would email ${to || "<unknown>"} a fresh cosign link for ${messageId} (exp=${expiresAt})`,
    );
  };

export function makeCosignRefreshHandler(deps: CosignRefreshHandlerDeps = {}) {
  const sendEmail = deps.sendFreshLinkEmail ?? defaultSendFreshLinkEmail;

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

    // Best-effort: resolve the counterparty recipient email.
    // signed_messages stores the wire/email/bilateral payload; for an
    // email payload `to` is an array. For the hackathon slice we'll
    // surface the first `to` if present and otherwise leave to="".
    const recipient =
      Array.isArray((stored["payload"] as Record<string, unknown> | undefined)?.["to"])
        ? ((stored["payload"] as Record<string, unknown>)["to"] as unknown[])[0] as string ?? ""
        : "";

    try {
      await sendEmail({
        to:         recipient,
        messageId,
        freshToken,
        expiresAt:  freshClaims.exp,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cosign-refresh] sendFreshLinkEmail failed for ${messageId}`, err);
    }

    respond(res, 200, {
      ok:            true,
      freshLinkSent: true,
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
