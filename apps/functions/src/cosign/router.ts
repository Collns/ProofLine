/**
 * @file router.ts
 * @module apps/functions/src/cosign
 *
 * Express sub-router for /v1/cosign/*. Mount in apps/functions/src/index.ts:
 *
 *   app.use("/v1/cosign", corsMiddleware, makeCosignRouter());
 *
 * Routes:
 *   GET  /v1/cosign/:messageId           — context + WebAuthn challenge
 *   POST /v1/cosign/:messageId/finalize  — append cosigner, queue anchor
 *   POST /v1/cosign/:messageId/refresh   — mint fresh JWS, send email
 */

import * as express from "express";

import { makeCosignContextHandler }  from "./cosign-context.handler.js";
import { makeCosignFinalizeHandler } from "./cosign-finalize.handler.js";
import {
  makeCosignRefreshHandler,
  type CosignRefreshHandlerDeps,
} from "./cosign-refresh.handler.js";

export interface CosignRouterDeps {
  refresh?: CosignRefreshHandlerDeps;
}

export function makeCosignRouter(deps: CosignRouterDeps = {}): express.Router {
  const router = express.Router();

  const context  = makeCosignContextHandler();
  const finalize = makeCosignFinalizeHandler();
  const refresh  = makeCosignRefreshHandler(deps.refresh ?? {});

  router.get("/:messageId", (req, res, next) => {
    context(req, res).catch(next);
  });
  router.post("/:messageId/finalize", (req, res, next) => {
    finalize(req, res).catch(next);
  });
  router.post("/:messageId/refresh", (req, res, next) => {
    refresh(req, res).catch(next);
  });

  return router;
}
