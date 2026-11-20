/**
 * @file countersign-context.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * GET /v1/bilateral/:id/countersign-context?token=<jws>   (PFL-182)
 *
 * Powers the counterparty ceremony on web-sign (same pattern as cosign in
 * #127). The portal redirects here; this endpoint:
 *   1. verifies the signed deep-link token and that it scopes to :id,
 *   2. confirms the document is PENDING_COUNTERPARTY,
 *   3. mints + persists a server-issued challenge bound to the canonical
 *      payload hash (bilateral_challenges/{docId}), single-use,
 *   4. returns the payload + hash so web-sign can show the exact document
 *      and run navigator.credentials.get against RP proofline-sign.web.app.
 *
 * All failures return 200 with `ok: false` so the page can distinguish them.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalize } from "@proofline/canonical";
import { sha256 } from "@proofline/crypto";

import type { BilateralRouterDeps } from "./types.js";
import { verifyCounterpartyJwsToken } from "./jws.helpers.js";

const CHALLENGE_TTL_SEC = 5 * 60;

export interface CountersignContextOk {
  ok:                    true;
  docId:                 string;
  docType:               string;
  drafterCompanyId:      string;
  counterpartyCompanyId: string;
  payload:               unknown;
  payloadHash:           string;
  challenge:             string;
  expiresAt:             number;
}

export type CountersignContextFailureCode =
  | "BILATERAL_LINK_INVALID"
  | "BILATERAL_LINK_EXPIRED"
  | "NOT_FOUND"
  | "ALREADY_SIGNED"
  | "REVOKED"
  | "WRONG_STATUS";

export interface CountersignContextFail {
  ok:     false;
  code:   CountersignContextFailureCode;
  detail: string;
}

export type CountersignContextResponse = CountersignContextOk | CountersignContextFail;

export function makeCountersignContextHandler(deps: BilateralRouterDeps) {
  return async function countersignContextHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const docId = req.params["id"];
    if (typeof docId !== "string" || docId.length === 0) {
      fail(res, "BILATERAL_LINK_INVALID", "Missing document id");
      return;
    }

    const token = typeof req.query["token"] === "string" ? (req.query["token"] as string) : "";
    if (!token) {
      fail(res, "BILATERAL_LINK_INVALID", "token query parameter is required");
      return;
    }

    const tokenResult = await verifyCounterpartyJwsToken(token);
    if (!tokenResult.ok) {
      const expired = /expired/i.test(tokenResult.detail);
      fail(res, expired ? "BILATERAL_LINK_EXPIRED" : "BILATERAL_LINK_INVALID", tokenResult.detail);
      return;
    }
    if (tokenResult.docId !== docId) {
      fail(res, "BILATERAL_LINK_INVALID", "Token does not match this document");
      return;
    }

    const docResult = await deps.bilateralService.getDocument(docId);
    if (!docResult.ok) {
      fail(res, "NOT_FOUND", docResult.detail);
      return;
    }
    const doc = docResult.value;

    // The token's signed counterparty claim must match the document, so a
    // valid token for one document can't unlock another.
    if (tokenResult.counterpartyId !== doc.payload.counterpartyCompanyId) {
      fail(res, "BILATERAL_LINK_INVALID", "Token counterparty does not match this document");
      return;
    }

    const statusResult = await deps.bilateralService.getStatus(docId);
    if (!statusResult.ok) {
      fail(res, "NOT_FOUND", statusResult.detail);
      return;
    }
    const status = statusResult.value;
    if (status === "BILATERAL_SIGNED") {
      fail(res, "ALREADY_SIGNED", "This document has already been signed by both parties.");
      return;
    }
    if (status === "REVOKED") {
      fail(res, "REVOKED", "This document has been revoked by the drafter.");
      return;
    }
    if (status !== "PENDING_COUNTERPARTY") {
      fail(res, "WRONG_STATUS", `This document is not awaiting a counterparty signature (status ${status}).`);
      return;
    }

    // Mint + persist the challenge: the RAW canonical payload bytes, exactly
    // like the sender's /v1/sign path, so the assertion binds to this payload
    // and the stored envelope passes @proofline/verification's challenge
    // check. payloadHash is base64url(sha256(canonical)).
    const canonical   = canonicalize(doc.payload);
    const challenge   = Buffer.from(canonical).toString("base64url");
    const payloadHash = Buffer.from(sha256(canonical)).toString("base64url");

    const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    await getFirestore().collection("bilateral_challenges").doc(docId).set({
      docId,
      challenge,
      payloadHash,
      cp:        tokenResult.counterpartyId,
      drafterId: tokenResult.drafterId,
      issuedAt:  nowSec,
      expiresAt: nowSec + CHALLENGE_TTL_SEC,
    });

    const response: CountersignContextOk = {
      ok:                    true,
      docId,
      docType:               doc.payload.docType,
      drafterCompanyId:      doc.payload.drafterCompanyId,
      counterpartyCompanyId: doc.payload.counterpartyCompanyId,
      payload:               doc.payload,
      payloadHash,
      challenge,
      expiresAt:             tokenResult.exp,
    };
    res.status(200).json(response);
  };
}

function fail(res: express.Response, code: CountersignContextFailureCode, detail: string): void {
  // 200 so the web-sign page can branch on `code`.
  res.status(200).json({ ok: false, code, detail } satisfies CountersignContextFail);
}
