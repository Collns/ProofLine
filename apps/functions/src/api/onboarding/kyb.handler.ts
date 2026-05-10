/**
 * @file kyb.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * POST /v1/onboard/kyb
 *
 * Runs KYB (Know Your Business) via the Middesk adapter (TDD §7.1).
 *
 * Flow:
 *   1. Validate body (companyId).
 *   2. Load company doc — must be pending_kyb.
 *   3. Call kybProvider.verifyBusiness() with legalName + EIN + state.
 *   4. Store the result (ok, vendorRef, flags, officers).
 *   5. If KYB passes → advance status to pending_kyc.
 *      If KYB fails  → set status to rejected, return 422.
 *
 * Auth: Firebase ID token — ownerUserId check.
 *
 * Note: Middesk is async in production (poll-until-complete).  The
 * makeMiddeskProvider already handles polling internally, so this handler
 * simply awaits the resolved promise.
 */

import * as express from "express";
import { z } from "zod";

import { ERR } from "./http.helpers.js";
import { getCompany, updateCompany } from "./onboarding.helpers.js";

// ─── KYB provider interface (mirrors packages/kyb) ───────────────────────────

export interface KYBProvider {
  verifyBusiness(input: {
    legalName: string;
    ein:       string;
    state:     string;
    country:   "US";
  }): Promise<{
    ok:        boolean;
    vendorRef: string;
    flags:     string[];
    officers:  { name: string; role: string }[];
    raw:       unknown;
  }>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const KybRequestSchema = z.object({
  companyId: z.string().min(1),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeKybHandler(deps: { kybProvider: KYBProvider }) {
  return async function kybHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse ──────────────────────────────────────────────────────────────

    const parseResult = KybRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId } = parseResult.data;
    const { userId }    = (req as any).user as { userId: string };

    // ── 2. Load company ───────────────────────────────────────────────────────

    const company = await getCompany(companyId);
    if (!company) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }
    if (company.ownerUserId !== userId) {
      res.status(403).json(ERR.forbidden());
      return;
    }
    if (company.onboardingStatus !== "pending_kyb") {
      res.status(409).json(
        ERR.conflict(
          "ONBOARDING_STEP_INVALID",
          `KYB not allowed in status: ${company.onboardingStatus}`
        )
      );
      return;
    }

    // ── 3. Run KYB ────────────────────────────────────────────────────────────

    let result: Awaited<ReturnType<KYBProvider["verifyBusiness"]>>;
    try {
      result = await deps.kybProvider.verifyBusiness({
        legalName: company.legalName,
        ein:       company.ein,
        state:     company.state,
        country:   "US",
      });
    } catch (err) {
      console.error("[kyb] Middesk call failed", err);
      res.status(502).json(
        ERR.internal("KYB provider unavailable. Please retry.")
      );
      return;
    }

    const now = Date.now();

    // ── 4. Store result ───────────────────────────────────────────────────────

    await updateCompany(companyId, {
      kybResult: {
        ok:         result.ok,
        vendorRef:  result.vendorRef,
        flags:      result.flags,
        officers:   result.officers,
        verifiedAt: now,
      },
    });

    // ── 5. Advance or reject ──────────────────────────────────────────────────

    if (!result.ok) {
      await updateCompany(companyId, { onboardingStatus: "rejected" });
      res.status(422).json(
        ERR.unprocessable(
          "KYB_FAILED",
          `Business verification failed. Flags: ${result.flags.join(", ") || "none"}`
        )
      );
      return;
    }

    await updateCompany(companyId, { onboardingStatus: "pending_kyc" });

    res.status(200).json({
      ok:       true,
      status:   "pending_kyc",
      vendorRef: result.vendorRef,
      officers:  result.officers,
    });
  };
}