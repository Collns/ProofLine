/**
 * @file draft.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/draft
 *
 * Creates a new bilateral document in DRAFT status.
 * Auth: Firebase ID token (authMiddleware sets req.user).
 */

import * as express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ERR, type BilateralRouterDeps } from "./types.js";

const DraftBodySchema = z.object({
  docType:               z.enum(["banking_change", "vendor_onboarding", "payment_terms"]),
  counterpartyCompanyId: z.string().min(1),
  content:               z.record(z.unknown()),
  expiresInSeconds:      z.number().int().min(3600).max(30 * 24 * 3600).default(7 * 24 * 3600),
});

export function makeDraftHandler(deps: BilateralRouterDeps) {
  return async function draftHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const { companyId } = (req as any).user as { userId: string; companyId: string };
    if (!companyId) {
      res.status(401).json(ERR.unauthorized("Missing company identity"));
      return;
    }

    // ── 2. Validate body ──────────────────────────────────────────────────────
    const parsed = DraftBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const body = parsed.data;

    // ── 3. Create document ───────────────────────────────────────────────────
    const docId = `doc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const nonce = randomUUID().replace(/-/g, ""); // 32 hex chars ≥ 22

    const result = await deps.bilateralService.draftDocument({
      docId,
      docType:               body.docType,
      drafterCompanyId:      companyId,
      counterpartyCompanyId: body.counterpartyCompanyId,
      content:               body.content,
      expiresInSeconds:      body.expiresInSeconds,
      nonce,
    });

    if (!result.ok) {
      const status = result.code === "DUPLICATE_DOC_ID" ? 409 : 500;
      res.status(status).json(ERR.conflict(result.code, result.detail));
      return;
    }

    res.status(201).json({
      docId:   result.value.docId,
      status:  "DRAFT",
      payload: result.value,
    });
  };
}