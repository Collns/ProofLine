/**
 * @file revoke.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/:id/revoke
 * Only the drafter company can revoke. Auth: Firebase ID token.
 */

import * as express from "express";
import { ERR, type BilateralRouterDeps } from "./types.js";

export function makeRevokeHandler(deps: BilateralRouterDeps) {
  return async function revokeHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { userId, companyId } = (req as any).user as { userId: string; companyId: string };
    const docId = req.params["id"];

    if (!docId) {
      res.status(400).json(ERR.badRequest("Missing document id"));
      return;
    }

    const result = await deps.bilateralService.revoke(docId, { userId, companyId });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        DOC_NOT_FOUND:   404,
        WRONG_ACTOR:     403,
        WRONG_STATUS:    409,
        ALREADY_REVOKED: 409,
      };
      res.status(statusMap[result.code] ?? 500).json(
        ERR.conflict(result.code, result.detail),
      );
      return;
    }

    res.status(200).json({ docId, status: "REVOKED" });
  };
}