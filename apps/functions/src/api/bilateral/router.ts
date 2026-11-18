/**
 * @file router.ts
 * @module apps/functions/src/api/bilateral
 *
 * Express sub-router for /v1/bilateral/*.
 *
 * Mount in apps/functions/src/index.ts:
 *
 *   import { makeBilateralRouter } from "./api/bilateral/router.js";
 *   app.use("/v1/bilateral", authMiddleware, makeBilateralRouter(deps));
 *
 * Routes:
 *   POST /v1/bilateral/draft              — create a bilateral document
 *   POST /v1/bilateral/sign-as-drafter    — drafter signs → PENDING_COUNTERPARTY
 *   POST /v1/bilateral/sign-as-counterparty — counterparty signs → BILATERAL_SIGNED
 *   GET  /v1/bilateral/:id                — fetch document + status
 *   POST /v1/bilateral/:id/revoke         — revoke document
 */

import * as express from "express";
import { makeDraftHandler }              from "./draft.handler.js";
import { makeSignAsDrafterHandler }      from "./sign-as-drafter.handler.js";
import { makeSignAsCounterpartyHandler } from "./sign-as-counterparty.handler.js";
import { makeGetDocumentHandler }        from "./get-document.handler.js";
import { makeRevokeHandler }             from "./revoke.handler.js";
import { ERR, type BilateralRouterDeps } from "./types.js";

function requireCompanyUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const user = (req as express.Request & { user?: { userId?: string; companyId?: string } }).user;
  if (!user?.userId || !user.companyId) {
    res.status(401).json(ERR.unauthorized("Sign in with a company account to use this endpoint"));
    return;
  }
  next();
}

export function makeBilateralRouter(deps: BilateralRouterDeps): express.Router {
  const router = express.Router();

  // Drafter routes need a verified company user (set by the Firebase auth
  // middleware mounted in index.ts). Counterparty routes authenticate with
  // the signed deep-link token instead.
  router.post("/draft",                 requireCompanyUser, makeDraftHandler(deps));
  router.post("/sign-as-drafter",       requireCompanyUser, makeSignAsDrafterHandler(deps));
  router.post("/sign-as-counterparty",  makeSignAsCounterpartyHandler(deps));
  router.get( "/:id",                   makeGetDocumentHandler(deps));
  router.post("/:id/revoke",            requireCompanyUser, makeRevokeHandler(deps));

  return router;
}