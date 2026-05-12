/**
 * @file sign-as-drafter.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/sign-as-drafter
 */

import * as express from "express";
import { z } from "zod";
import { ERR, type BilateralRouterDeps } from "./types.js";
import { buildCounterpartyJwsLink } from "./jws.helpers.js";

const SignAsDrafterSchema = z.object({
  docId:             z.string().min(1),
  sig:               z.string().min(1),
  counterpartyEmail: z.string().email(),
  drafterName:       z.string().min(1),
});

export function makeSignAsDrafterHandler(deps: BilateralRouterDeps) {
  return async function signAsDrafterHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { userId, companyId } = (req as any).user as { userId: string; companyId: string };

    const parsed = SignAsDrafterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }

    const { docId, sig, counterpartyEmail, drafterName } = parsed.data;

    const result = await deps.bilateralService.signAsDrafter(
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

    const doc = result.value;

    const signLink = await buildCounterpartyJwsLink({
      baseUrl:          deps.counterpartyPortalBaseUrl,
      docId,
      drafterCompanyId: companyId,
      expiresAt:        doc.payload.expiresAt,
    });

    await deps.email.sendBilateralRequest(
      counterpartyEmail,
      {
        documentId:     docId,
        documentType:   doc.payload.docType,
        drafterName:    drafterName,
        drafterCompany: companyId,
      },
      signLink,
    );

    res.status(200).json({ docId, status: "PENDING_COUNTERPARTY", signLink });
  };
}