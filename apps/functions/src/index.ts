/**
 * @file index.ts
 * @module apps/functions
 *
 * Firebase Functions entry point. Re-exports deployable handlers.
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
 */

import * as express from "express";

import {
  makeAnchorScheduler,
  makeAnchorAdminRouter,
  makeAnchorRunDeps,
} from "./anchoring/index.js";

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
