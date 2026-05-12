/**
 * @file cosign-context.handler.ts
 * @module apps/functions/src/cosign
 *
 * GET /v1/cosign/:messageId?token=<jws>  (PFL-062)
 *
 * Returns everything the cosign landing page needs to render its
 * 6-step verification checklist:
 *   1. envelope          → server returns the canonical envelope shape
 *   2. payloadHash       → recomputed by the client, compared to JWS claim
 *   3. signer            → display info from users/{uid} + companies/{cid}
 *   4. expiresAt         → echoed JWS exp so the UI can show a countdown
 *   5. cosignChallenge   → base64url challenge bytes for navigator.credentials.get
 *
 * Failure modes (all 200 OK with `ok: false` body — UI distinguishes):
 *   COSIGN_LINK_INVALID  malformed JWS or claim missing
 *   COSIGN_LINK_EXPIRED  JWS exp is in the past
 *   NOT_FOUND            no signed_messages/{messageId} doc
 *   ALREADY_COSIGNED     envelope already has > 1 signer
 *
 * The challenge is persisted to `cosign_challenges/{messageId}` for
 * the finalize handler to consume.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";

import {
  decodeCosignJws,
  adaptStoredEnvelope,
  resolveCosignSignerInfo,
  hasCosigner,
  newCosignChallenge,
} from "./cosign.helpers.js";
import type { CosignContextResponse } from "./cosign.types.js";

// Challenges are short-lived — the user has roughly one biometric prompt
// to use them before the next refresh.
const CHALLENGE_TTL_SEC = 5 * 60;

export function makeCosignContextHandler() {
  return async function cosignContextHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const messageId = req.params["messageId"];
    if (typeof messageId !== "string" || messageId.length === 0) {
      respond(res, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "messageId is required",
      });
      return;
    }

    const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
    if (!token) {
      respond(res, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "token query parameter is required",
      });
      return;
    }

    // 1. Decode JWS structurally (signature check is deferred — see
    //    TODO in cosign.helpers.ts).
    const decoded = decodeCosignJws(token);
    if (!decoded.ok) {
      const failure: CosignContextResponse =
        decoded.reason === "EXPIRED"
          ? {
              ok:     false,
              code:   "COSIGN_LINK_EXPIRED",
              detail: "This cosign link has expired. Request a fresh link to continue.",
            }
          : {
              ok:     false,
              code:   "COSIGN_LINK_INVALID",
              detail: `Cosign token could not be decoded (${decoded.reason})`,
            };
      respond(res, failure);
      return;
    }

    // The JWS `sub` claim MUST agree with the URL — refuse the request
    // otherwise, so a tampered URL can't trick the server into returning
    // the wrong envelope.
    if (decoded.claims.sub !== messageId) {
      respond(res, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "Token subject does not match messageId in URL",
      });
      return;
    }

    // 2. Look up the envelope.
    const firestore = getFirestore();
    const snap = await firestore.collection("signed_messages").doc(messageId).get();
    if (!snap.exists) {
      respond(res, {
        ok:     false,
        code:   "NOT_FOUND",
        detail: `No signed message with id ${messageId}`,
      });
      return;
    }

    const envelope = adaptStoredEnvelope(snap.data() as Record<string, unknown>);

    if (hasCosigner(envelope)) {
      respond(res, {
        ok:     false,
        code:   "ALREADY_COSIGNED",
        detail: "This wire has already been cosigned. No further action is required.",
      });
      return;
    }

    // 3. Resolve display info for the original signer.
    const signer = await resolveCosignSignerInfo(envelope, firestore);

    // 4. Mint + persist a cosign challenge.
    const cosignChallenge = newCosignChallenge();
    const nowSec = Math.floor(Date.now() / 1000);
    await firestore.collection("cosign_challenges").doc(messageId).set({
      messageId,
      challenge:   cosignChallenge,
      payloadHash: envelope.payloadHash,
      iss:         decoded.claims.iss,
      issuedAt:    nowSec,
      expiresAt:   nowSec + CHALLENGE_TTL_SEC,
    });

    const response: CosignContextResponse = {
      ok:              true,
      messageId,
      envelope,
      payloadHash:     envelope.payloadHash,
      payloadType:     envelope.payloadType,
      payload:         envelope.payload,
      signer,
      expiresAt:       decoded.claims.exp,
      cosignChallenge,
    };
    respond(res, response);
  };
}

function respond(res: express.Response, body: CosignContextResponse): void {
  res.status(200).json(body);
}
