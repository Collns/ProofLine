/**
 * @file index.ts
 * @module apps/functions
 *
 * Firebase Functions entry point. Re-exports deployable handlers and
 * exposes a makeApp() factory for the public verify endpoint.
 *
 * Anchor slice (PFL-027):
 *   - `anchorBatchScheduler` — runs every 5 minutes, drains anchor_queue,
 *     posts a Merkle root to Base Sepolia.
 *   - `anchorAdminApi` — Express app exposing POST /v1/admin/anchor/run
 *     for demo prep and live-demo triggers (TDD §6.3).
 *
 * Both share `makeAnchorRunDeps()`, which selects real (viem against
 * Base Sepolia) vs stub providers based on env. See
 * src/anchoring/service-factory.ts for the env mapping.
 *
 * Verify slice (PFL-023):
 *   - `makeApp({ firestore, chainReader })` — composes the express app
 *     for the public verify endpoint at GET /v1/verify/:id. Deploy
 *     wiring (Firebase HTTPS function export) lands in a follow-up.
 *
 * Existing routers (left commented while their wiring lands):
 *   - /v1/onboard via api/onboarding/router.ts (PFL-017)
 *   - /v1/sign     via signing/handlers/* (PFL-021)
 */

import * as express from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { AnchorProvider } from "@proofline/anchoring";

import {
  makeAnchorScheduler,
  makeAnchorAdminRouter,
  makeAnchorRunDeps,
} from "./anchoring/index.js";

import { makeVerifyRouter, makeVerifyService } from "./verify/index.js";

// ─── Anchor scheduler (every 5 minutes) ───────────────────────────────────────

// Lazily build deps so a missing env var on cold-start doesn't crash
// unrelated functions. The scheduler itself is exported eagerly because
// firebase-functions requires top-level handles for deployment.
export const anchorBatchScheduler = makeAnchorScheduler(makeAnchorRunDeps());

// ─── Admin HTTP — POST /v1/admin/anchor/run ──────────────────────────────────

const adminApp = (express as any)();
adminApp.use(express.json());
adminApp.use("/v1/admin/anchor", makeAnchorAdminRouter(makeAnchorRunDeps()));

export const anchorAdminApi = adminApp;

// ─── Public verify endpoint (PFL-023) ────────────────────────────────────────

export interface AppDeps {
  firestore: Firestore;
  /** Read-only chain reader used by the verify endpoint. */
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

export function makeApp(deps: AppDeps): express.Express {
  const app = (express as any)();
  app.use(express.json());

  // Public verify endpoint — no auth, CORS-open, see verify/README.md.
  const verifyService = makeVerifyService(deps);
  app.use("/v1/verify", makeVerifyRouter({ service: verifyService }));

  // Onboarding + signing routers wire here when their slices ship.

  return app;
}

/* Onboarding wiring (deferred to its own slice — keeps PFL-027 self-contained):

   import { makeOnboardingRouter } from "./api/onboarding/router.js";
   app.use("/v1/onboard", authMiddleware, makeOnboardingRouter({
     sendVerificationCode: resendProvider.sendVerificationCode.bind(resendProvider),
     kybProvider:            makeMiddeskProvider({ apiKey: ... }),
     stripeIdentityProvider: makeStripeIdentityProvider({ secretKey: ... }),
     kmsProvider:            makeKmsProvider({ ... }),
     anchorProvider:         makeAnchorProvider({ ... }),
   }));
*/
