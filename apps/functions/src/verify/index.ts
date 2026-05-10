/**
 * @file index.ts
 * @module apps/functions/src/verify
 *
 * Public verify router. Mount in apps/functions/src/index.ts:
 *
 *   import { makeVerifyRouter } from "./verify/index.js";
 *   app.use("/v1/verify", makeVerifyRouter({ service }));
 *
 * Routes:
 *   GET /v1/verify/:id   — verify by envelope id (5-state response)
 */

import * as express from "express";

import { makeVerifyHandler } from "./handlers/verify.handler.js";
import type { VerifyService } from "./service-factory.js";

export interface VerifyRouterDeps {
  service: VerifyService;
  now?: () => number;
}

export function makeVerifyRouter(deps: VerifyRouterDeps): express.Router {
  const router = express.Router();

  // Preflight for the public endpoint. Browsers don't send a preflight
  // for a simple GET, but allowing OPTIONS keeps us forward-compatible
  // with adding custom headers later (e.g., a verify-page nonce).
  router.options("/:id", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
  });

  router.get("/:id", makeVerifyHandler(deps));

  return router;
}

export { makeVerifyService } from "./service-factory.js";
export type { VerifyService, VerifyServiceDeps } from "./service-factory.js";
export type { VerificationResponse, SerializedAnchor } from "./contract.js";
