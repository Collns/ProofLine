/**
 * @file sign-as-counterparty.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/sign-as-counterparty
 *
 * Counterparty signs the document → transitions to BILATERAL_SIGNED.
 * Auth: JWS token from the deep-link (validated via X-ProofLine-Bilateral-Token header).
 * No Firebase Auth required — the signed JWS is the auth.
 */

import * as express from "express";
import { z } from "zod";
import { ERR, type BilateralRouterDeps } from "./types.js";
import { verifyCounterpartyJwsToken } from "./jws.helpers.js";

const SignAsCounterpartySchema = z.object({
  docId:     z.string().min(1),
  sig:       z.string().min(1),     // base64url WebAuthn assertion signature
  companyId: z.string().min(1),     // counterparty's companyId (self-declared, verified by state machine)
  userId:    z.string().min(1),     // counterparty's userId
});

export function makeSignAsCounterpartyHandler(deps: BilateralRouterDeps) {
  return async function signAsCounterpartyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // ── 1. Validate JWS token from header ─────────────────────────────────────
    const token = req.headers["x-proofline-bilateral-token"] as string | undefined;
    if (!token) {
      res.status(401).json(ERR.unauthorized("Missing X-ProofLine-Bilateral-Token header"));
      return;
    }

    const tokenResult = await verifyCounterpartyJwsToken(token);
    if (!tokenResult.ok) {
      res.status(401).json(ERR.unauthorized(tokenResult.detail));
      return;
    }

    // ── 2. Validate body ──────────────────────────────────────────────────────
    const parsed = SignAsCounterpartySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { docId, sig, companyId, userId } = parsed.data;

    // Token must scope to the same docId.
    if (tokenResult.docId !== docId) {
      res.status(403).json(ERR.forbidden("Token docId does not match request docId"));
      return;
    }

    // ── 3. Sign ───────────────────────────────────────────────────────────────
    const result = await deps.bilateralService.signAsCounterparty(
      docId,
      { userId, companyId },
      sig,
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        DOC_NOT_FOUND:   404,
        WRONG_ACTOR:     403,
        WRONG_STATUS:    409,
        EXPIRED:         409,
        ALREADY_REVOKED: 409,
      };
      res.status(statusMap[result.code] ?? 500).json(
        ERR.conflict(result.code, result.detail),
      );
      return;
    }

    res.status(200).json({
      docId,
      status: "BILATERAL_SIGNED",
    });
  };
}