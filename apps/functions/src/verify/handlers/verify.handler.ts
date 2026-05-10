/**
 * @file verify.handler.ts
 * @module apps/functions/src/verify
 *
 * GET /v1/verify/:id — public verification endpoint.
 *
 * Always 200 except on INVALID_ID (400) and unhandled exceptions (500).
 * The five verification states (verified / bilateral / suspected_spoof /
 * rejected / unverified_sender) all return 200 — apps/web-verify
 * distinguishes them via the `state` field in the body.
 */

import * as express from "express";
import type { SignedEnvelope as SignedEnvelopeType } from "@proofline/types";
import { SignedEnvelope } from "@proofline/types";
import { verifyEnvelope } from "@proofline/verification";

import type { VerifyService } from "../service-factory.js";
import { shapeResponse } from "../shape-response.js";
import { unverifiedSenderResponse } from "../unverified-sender.js";
import type { VerificationResponse } from "../contract.js";
import { ERR, isValidVerifyId } from "./http.helpers.js";

export interface VerifyHandlerDeps {
  service: VerifyService;
  /** Injected for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

const CACHE_HEADER = "public, max-age=60, s-maxage=300";

function setPublicHeaders(res: express.Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function makeVerifyHandler(deps: VerifyHandlerDeps) {
  return async function verifyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    setPublicHeaders(res);

    const id = req.params.id;
    if (!isValidVerifyId(id)) {
      res
        .status(400)
        .json(ERR.badRequest("INVALID_ID", "id must be 8-128 url-safe characters"));
      return;
    }

    let body: VerificationResponse;
    try {
      const raw = await deps.service.fetchEnvelope(id);
      if (!raw) {
        body = unverifiedSenderResponse();
      } else {
        // Stored envelopes may have shed their zod-defaulted fields if
        // someone wrote them with `set({...})` after construction. Run
        // them through the schema again so verifyEnvelope sees a
        // canonical shape (or so we can reject early on a malformed doc).
        const parsed = SignedEnvelope.safeParse(raw);
        if (!parsed.success) {
          body = {
            ok: false,
            state: "rejected",
            code: "PAYLOAD_HASH_MISMATCH",
            detail: `stored envelope failed schema validation: ${parsed.error.issues
              .map((i) => i.path.join("."))
              .join(", ")}`,
          };
        } else {
          const envelope: SignedEnvelopeType = parsed.data;
          const result = await verifyEnvelope({
            envelope,
            registry: deps.service.registry,
            now: deps.now,
          });
          body = shapeResponse(result);
        }
      }
    } catch (err) {
      // We deliberately do not leak err.message — verification failures
      // we want to surface land in the rejected branch above; an
      // unexpected throw is a bug we should report as 500 only.
      // eslint-disable-next-line no-console
      console.error("[verify] unhandled error for id", id, err);
      res.status(500).json(ERR.internal("verification failed unexpectedly"));
      return;
    }

    res.setHeader("Cache-Control", CACHE_HEADER);
    res.status(200).json(body);
  };
}
