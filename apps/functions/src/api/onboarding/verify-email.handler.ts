/**
 * @file verify-email.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * Two endpoints:
 *
 *   POST /v1/onboard/verify-email
 *     Sends a 6-digit OTP to the owner's email address via Resend.
 *     Stores a sha256 of the code + expiry in the company doc.
 *
 *   POST /v1/onboard/verify-email-code
 *     Validates the submitted code and advances status to pending_kyb.
 *
 * Auth: Firebase ID token — ownerUserId check on both endpoints.
 */

import * as express from "express";
import { z } from "zod";

import { ERR } from "./http.helpers.js";
import {
  getCompany,
  updateCompany,
  generateEmailCode,
  verifyEmailCode,
} from "./onboarding.helpers.js";

// ─── /verify-email ────────────────────────────────────────────────────────────

const SendCodeRequestSchema = z.object({
  companyId: z.string().min(1),
});

export function makeVerifyEmailHandler(deps: {
  sendVerificationCode: (to: string, code: string) => Promise<void>;
}) {
  return async function verifyEmailHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    const parseResult = SendCodeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId } = parseResult.data;
    const { userId } = (req as any).user as { userId: string };

    const company = await getCompany(companyId);
    if (!company) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }
    if (company.ownerUserId !== userId) {
      res.status(403).json(ERR.forbidden());
      return;
    }
    if (!["pending_email", "pending_kyb"].includes(company.onboardingStatus)) {
      res.status(409).json(
        ERR.conflict("ONBOARDING_STEP_INVALID", `Email send not allowed in status: ${company.onboardingStatus}`)
      );
      return;
    }

    const { code, codeHash, expiresAt } = generateEmailCode();

    // Store hash (never store the plaintext code)
    await updateCompany(companyId, {
      emailCode:          codeHash,
      emailCodeExpiresAt: expiresAt,
    });

    // Send via Resend adapter
    await deps.sendVerificationCode(company.ownerEmail, code);

    res.status(200).json({
      sent:    true,
      to:      company.ownerEmail,
      message: "Verification code sent. Expires in 10 minutes.",
    });
  };
}

// ─── /verify-email-code ───────────────────────────────────────────────────────

const ConfirmCodeRequestSchema = z.object({
  companyId: z.string().min(1),
  code:      z.string().min(6).max(6),
});

export function makeVerifyEmailCodeHandler() {
  return async function verifyEmailCodeHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    const parseResult = ConfirmCodeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId, code } = parseResult.data;
    const { userId } = (req as any).user as { userId: string };

    const company = await getCompany(companyId);
    if (!company) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }
    if (company.ownerUserId !== userId) {
      res.status(403).json(ERR.forbidden());
      return;
    }
    if (!["pending_email", "pending_kyb"].includes(company.onboardingStatus)) {
      res.status(409).json(
        ERR.conflict("ONBOARDING_STEP_INVALID", `Email verification not allowed in status: ${company.onboardingStatus}`)
      );
      return;
    }

    // Guard: code must have been issued
    if (!company.emailCode || !company.emailCodeExpiresAt) {
      res.status(409).json(
        ERR.conflict("EMAIL_CODE_NOT_ISSUED", "No active verification code. Call /verify-email first.")
      );
      return;
    }

    // Guard: expiry
    if (Date.now() > company.emailCodeExpiresAt) {
      res.status(422).json(
        ERR.unprocessable("EMAIL_CODE_EXPIRED", "Verification code expired. Request a new one.")
      );
      return;
    }

    // Guard: code match
    if (!verifyEmailCode(code, company.emailCode)) {
      res.status(422).json(
        ERR.unprocessable("EMAIL_CODE_INVALID", "Invalid verification code.")
      );
      return;
    }

    // Advance
    await updateCompany(companyId, {
      onboardingStatus: "pending_kyb",
      emailVerifiedAt:  Date.now(),
      emailCode:        undefined,          // clear code after use
      emailCodeExpiresAt: undefined,
    });

    res.status(200).json({ ok: true, status: "pending_kyb" });
  };
}