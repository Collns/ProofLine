/**
 * @file verify-dns.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * POST /v1/onboard/verify-dns
 *
 * Queries three independent DNS resolvers for the TXT record
 * `_proofline.{domain}` and expects at least 2 of 3 to return
 * `proofline-verify={token}` (TDD §5.1).
 *
 * Flow:
 *   1. Validate body (companyId).
 *   2. Load company doc — must be in pending_dns or pending_email status.
 *   3. Run DNS check against all three resolvers.
 *   4. If 2+ resolvers agree → advance status to pending_email.
 *   5. Return result with resolver detail.
 *
 * Auth: Firebase ID token — must be the ownerUserId of the company.
 */

import * as express from "express";
import { z } from "zod";

import { ERR } from "./http.helpers.js";
import { getCompany, updateCompany, verifyDnsTxtRecord } from "./onboarding.helpers.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

const VerifyDnsRequestSchema = z.object({
  companyId: z.string().min(1),
});

type VerifyDnsResponse = {
  ok:         boolean;
  domain:     string;
  status:     string;
  resolvers:  string;   // detail string from each resolver
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeVerifyDnsHandler() {
  return async function verifyDnsHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse ──────────────────────────────────────────────────────────────

    const parseResult = VerifyDnsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId } = parseResult.data;
    const { userId } = (req as any).user as { userId: string };

    // ── 2. Load company ───────────────────────────────────────────────────────

    const company = await getCompany(companyId);
    if (!company) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }

    if (company.ownerUserId !== userId) {
      res.status(403).json(ERR.forbidden("Only the company owner can advance onboarding"));
      return;
    }

    if (!["pending_dns", "pending_email"].includes(company.onboardingStatus)) {
      res.status(409).json(
        ERR.conflict(
          "ONBOARDING_STEP_INVALID",
          `DNS verification not allowed in status: ${company.onboardingStatus}`
        )
      );
      return;
    }

    // ── 3. DNS check ──────────────────────────────────────────────────────────

    const { ok, detail } = await verifyDnsTxtRecord(company.domain, company.dnsToken);

    if (!ok) {
      // Return 200 with ok=false rather than an error — the wizard polls this.
      const response: VerifyDnsResponse = {
        ok:        false,
        domain:    company.domain,
        status:    company.onboardingStatus,
        resolvers: detail,
      };
      res.status(200).json(response);
      return;
    }

    // ── 4. Advance status ─────────────────────────────────────────────────────

    await updateCompany(companyId, {
      onboardingStatus: "pending_email",
      dnsVerifiedAt:    Date.now(),
    });

    const response: VerifyDnsResponse = {
      ok:        true,
      domain:    company.domain,
      status:    "pending_email",
      resolvers: detail,
    };

    res.status(200).json(response);
  };
}