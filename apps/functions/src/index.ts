/**
 * @file index.ts
 * @module apps/functions
 *
 * Cloud Functions entry. Composes the express app and exposes a
 * makeApp() factory; deploy wiring (Firebase HTTPS function) lands in
 * a follow-up. Sub-routers live in src/api/* and src/verify/.
 *
 * Existing routers (left commented while their wiring lands):
 *   - /v1/onboard via api/onboarding/router.ts (PFL-017)
 *   - /v1/sign     via signing/handlers/* (PFL-021)
 */

import express from "express";
import type { Firestore } from "firebase-admin/firestore";
import type { AnchorProvider } from "@proofline/anchoring";

import { makeVerifyRouter, makeVerifyService } from "./verify/index.js";

export interface AppDeps {
  firestore: Firestore;
  /** Read-only chain reader used by the verify endpoint. */
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

export function makeApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json());

  // Public verify endpoint — no auth, CORS-open, see verify/README.md.
  const verifyService = makeVerifyService(deps);
  app.use("/v1/verify", makeVerifyRouter({ service: verifyService }));

  // Onboarding + signing routers wire here when their slices ship.

  return app;
}
