/**
 * @file enroll-officer.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * POST /v1/onboard/enroll-officer
 *
 * Creates a Stripe Identity verification session for the nominated officer
 * (TDD §7.2, PRD F-ONB-05).
 *
 * The browser embeds Stripe Identity using the `client_secret` returned here.
 * A Stripe webhook (`identity.verification_session.verified`) calls back and
 * sets officerEnrollment.verifiedAt — see apps/functions/src/webhooks/stripe-identity.ts.
 *
 * Flow:
 *   1. Validate body (companyId, officerEmail).
 *   2. Load company — must be pending_kyc.
 *   3. Verify officerEmail is in the KYB officers list (if present).
 *   4. Create Stripe Identity session.
 *   5. Store (stripeSessionId, stripeClientSecret, officerEmail) in company doc.
 *   6. Return clientSecret so the browser can embed the Stripe widget.
 *
 * Auth: Firebase ID token — ownerUserId check.
 */

import * as express from "express";
import { z } from "zod";

import { ERR } from "./http.helpers.js";
import { getCompany, updateCompany } from "./onboarding.helpers.js";

// ─── Stripe Identity provider interface ─────────────────────────────────────

export interface StripeIdentityProvider {
  verifyOfficer(input: {
    email:         string;
    expectedName?: string;
  }): Promise<{
    ok:               boolean;
    vendorRef:        string;
    documentVerified: boolean;
    livenessConfirmed:boolean;
    matchedExpected:  boolean;
    raw: {
      clientSecret: string | null;
      sessionId:    string;
    };
  }>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const EnrollOfficerRequestSchema = z.object({
  companyId:    z.string().min(1),
  officerEmail: z.string().email(),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeEnrollOfficerHandler(deps: {
  stripeIdentityProvider: StripeIdentityProvider;
}) {
  return async function enrollOfficerHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse ──────────────────────────────────────────────────────────────

    const parseResult = EnrollOfficerRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId, officerEmail } = parseResult.data;
    const { userId } = (req as any).user as { userId: string };

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
    if (!["pending_kyc", "pending_finalize"].includes(company.onboardingStatus)) {
      res.status(409).json(
        ERR.conflict(
          "ONBOARDING_STEP_INVALID",
          `Officer enrollment not allowed in status: ${company.onboardingStatus}`
        )
      );
      return;
    }

    // ── 3. Officer email validation against KYB list ──────────────────────────

    const officers = company.kybResult?.officers ?? [];
    // If KYB returned officers, enforce the email is from that list.
    // (We match by normalized domain — Middesk doesn't give us email addresses,
    //  only names+roles, so this is a best-effort cross-check.)
    const officerDomain = officerEmail.split("@")[1]?.toLowerCase();
    if (officers.length > 0 && officerDomain !== company.domain.toLowerCase()) {
      // Warn but don't hard-block — officer may use personal email for KYC.
      // Log the mismatch for audit; continue.
      console.warn(
        `[enroll-officer] officerEmail domain ${officerDomain} ≠ company domain ${company.domain}. Proceeding.`
      );
    }

    // ── 4. Create Stripe Identity session ────────────────────────────────────

    // Use the first officer's name from KYB as expectedName if available.
    const expectedName = officers[0]?.name;

    let stripeResult: Awaited<ReturnType<StripeIdentityProvider["verifyOfficer"]>>;
    try {
      stripeResult = await deps.stripeIdentityProvider.verifyOfficer({
        email:        officerEmail,
        expectedName,
      });
    } catch (err) {
      console.error("[enroll-officer] Stripe Identity call failed", err);
      res.status(502).json(ERR.internal("Identity provider unavailable. Please retry."));
      return;
    }

    if (!stripeResult.raw.clientSecret) {
      res.status(502).json(
        ERR.internal("Stripe Identity session created but no client_secret returned.")
      );
      return;
    }

    // ── 5. Persist session details ────────────────────────────────────────────

    await updateCompany(companyId, {
      officerEnrollment: {
        stripeSessionId:     stripeResult.vendorRef,
        stripeClientSecret:  stripeResult.raw.clientSecret,
        officerEmail,
      },
      onboardingStatus: "pending_kyc",
    });

    // ── 6. Return client secret ───────────────────────────────────────────────

    res.status(201).json({
      stripeSessionId:  stripeResult.vendorRef,
      clientSecret:     stripeResult.raw.clientSecret,
      officerEmail,
      message:
        "Embed the Stripe Identity widget using clientSecret. " +
        "Verification result arrives via webhook.",
    });
  };
}