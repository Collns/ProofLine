/**
 * @file router.ts
 * @module apps/functions/src/api/onboarding
 *
 * Express sub-router for /v1/onboard/*.
 *
 * Mount in apps/functions/src/index.ts:
 *
 *   import { makeOnboardingRouter } from "./api/onboarding/router.js";
 *   app.use("/v1/onboard", authMiddleware, makeOnboardingRouter(deps));
 *
 * Routes:
 *   POST /v1/onboard/start               — create company + return DNS token
 *   POST /v1/onboard/verify-dns          — DNS TXT check (polls; idempotent)
 *   POST /v1/onboard/verify-email        — send OTP to owner email
 *   POST /v1/onboard/verify-email-code   — confirm OTP
 *   POST /v1/onboard/kyb                 — Middesk business verification
 *   POST /v1/onboard/enroll-officer      — Stripe Identity session for officer KYC
 *   POST /v1/onboard/finalize            — KMS key + role cred + anchor
 */

import * as express from "express";

import { makeStartHandler }            from "./start.handler.js";
import { makeVerifyDnsHandler }        from "./verify-dns.handler.js";
import {
  makeVerifyEmailHandler,
  makeVerifyEmailCodeHandler,
}                                      from "./verify-email.handler.js";
import { makeKybHandler }              from "./kyb.handler.js";
import { makeEnrollOfficerHandler }    from "./enroll-officer.handler.js";
import { makeFinalizeHandler }         from "./finalize.handler.js";
import type { KYBProvider }            from "./kyb.handler.js";
import type { StripeIdentityProvider } from "./enroll-officer.handler.js";
import type { KmsProvider, AnchorProvider } from "./finalize.handler.js";

// ─── Deps type ────────────────────────────────────────────────────────────────

export interface OnboardingRouterDeps {
  /** Resend (or stub) email provider — sendVerificationCode. */
  sendVerificationCode: (to: string, code: string) => Promise<void>;
  /** Middesk (or stub) KYB provider. */
  kybProvider: KYBProvider;
  /** Stripe Identity (or stub) officer KYC provider. */
  stripeIdentityProvider: StripeIdentityProvider;
  /** Cloud KMS (or stub) key management provider. */
  kmsProvider: KmsProvider;
  /** On-chain anchor (or stub) provider. */
  anchorProvider: AnchorProvider;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function makeOnboardingRouter(deps: OnboardingRouterDeps): express.Router {
  const router = express.Router();

  // POST /start
  router.post("/start", makeStartHandler());

  // POST /verify-dns
  router.post("/verify-dns", makeVerifyDnsHandler());

  // POST /verify-email   — send OTP
  router.post(
    "/verify-email",
    makeVerifyEmailHandler({ sendVerificationCode: deps.sendVerificationCode })
  );

  // POST /verify-email-code  — confirm OTP
  router.post("/verify-email-code", makeVerifyEmailCodeHandler());

  // POST /kyb
  router.post("/kyb", makeKybHandler({ kybProvider: deps.kybProvider }));

  // POST /enroll-officer
  router.post(
    "/enroll-officer",
    makeEnrollOfficerHandler({ stripeIdentityProvider: deps.stripeIdentityProvider })
  );

  // POST /finalize
  router.post(
    "/finalize",
    makeFinalizeHandler({
      kmsProvider:    deps.kmsProvider,
      anchorProvider: deps.anchorProvider,
    })
  );

  return router;
}