/**
 * @file get-document.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * GET /v1/bilateral/:id
 * Returns the document payload + current derived status.
 * Auth: Firebase ID token OR valid JWS token (counterparty read).
 */

import * as express from "express";
import { ERR, type BilateralRouterDeps } from "./types.js";
import { verifyCounterpartyJwsToken } from "./jws.helpers.js";

export function makeGetDocumentHandler(deps: BilateralRouterDeps) {
  return async function getDocumentHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const docId = req.params["id"];
    if (!docId) {
      res.status(400).json(ERR.badRequest("Missing document id"));
      return;
    }

    // Allow access via Firebase auth OR a valid JWS deep-link token.
    const user = (req as any).user as { userId: string; companyId: string } | undefined;
    const token = req.headers["x-proofline-bilateral-token"] as string | undefined;

    if (!user && !token) {
      res.status(401).json(ERR.unauthorized("Authentication required"));
      return;
    }

    if (!user && token) {
      const tokenResult = await verifyCounterpartyJwsToken(token);
      if (!tokenResult.ok || tokenResult.docId !== docId) {
        res.status(401).json(ERR.unauthorized("Invalid or mismatched token"));
        return;
      }
    }

    const statusResult = await deps.bilateralService.getStatus(docId);
    if (!statusResult.ok) {
      res.status(404).json(ERR.notFound(statusResult.detail));
      return;
    }

    res.status(200).json({
      docId,
      status: statusResult.value,
    });
  };
}