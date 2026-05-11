/**
 * @file index.ts
 * @module apps/functions
 *
 * Firebase Functions entry point. Exports deployable handlers:
 *
 *   - `anchorBatchScheduler` (scheduled): runs every 5 minutes, drains
 *     anchor_queue, posts a Merkle root to Base Sepolia (PFL-027).
 *   - `anchorAdmin` (HTTP): POST /v1/admin/anchor/run for demo prep
 *     and live-demo triggers (TDD §6.3).
 *   - `api` (HTTP): public verify endpoint GET /v1/verify/:id (PFL-023).
 *
 * Existing routers still pending HTTP wiring (live as code only):
 *   - /v1/onboard via api/onboarding/router.ts (PFL-017)
 *   - /v1/sign    via signing/handlers/* (PFL-021)
 *
 * Module-load principle:
 *   Anything that touches env-dependent config (anchor provider, chain
 *   reader, Firestore) is built LAZILY on the first request that needs
 *   it. This lets `firebase deploy` analyse the bundle even when secrets
 *   (BASE_SEPOLIA_RPC etc.) aren't present at build time. A misconfigured
 *   prod env surfaces as a request-time 500 instead of a deploy failure.
 */

import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  makeAnchorAdminRouter,
  makeAnchorRunDeps,
  makeStubAnchorProvider,
  runAnchorBatchOnce,
} from "./anchoring/index.js";
import type { RunAnchorDeps } from "./anchoring/index.js";

import { makeVerifyRouter, makeVerifyService } from "./verify/index.js";

// ─── Firebase Admin (idempotent — module may be re-imported across invokes) ─

if (getApps().length === 0) {
  initializeApp();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
//
// The popup/admin/verify pages on web.app subdomains call these endpoints
// cross-origin. We hand-roll a small allowlist middleware instead of
// pulling in the `cors` npm dep — the surface is tiny and we want zero
// surprise headers in the deployed bundle.

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://proofline-sign.web.app",
  "https://proofline-counterparty.web.app",
  "https://proofline-verify.web.app",
  "https://proofline-admin.web.app",
  // Hosting also serves these under the .firebaseapp.com TLD.
  "https://proofline-sign.firebaseapp.com",
  "https://proofline-counterparty.firebaseapp.com",
  "https://proofline-verify.firebaseapp.com",
  "https://proofline-admin.firebaseapp.com",
]);

function corsMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-ProofLine-Challenge-Id",
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

// ─── Lazy dependency factory ─────────────────────────────────────────────────
//
// makeAnchorRunDeps() throws in NODE_ENV=production if BASE_SEPOLIA_RPC /
// DEPLOYER_PRIVATE_KEY / ANCHOR_CONTRACT_ADDRESS aren't set. That's the
// right behaviour at runtime, but blocks `firebase deploy` from analysing
// the bundle when secrets aren't yet wired. Cache after the first
// successful call so per-request cost is amortised.

let cachedAnchorDeps: RunAnchorDeps | null = null;
function anchorDeps(): RunAnchorDeps {
  if (cachedAnchorDeps) return cachedAnchorDeps;
  cachedAnchorDeps = makeAnchorRunDeps();
  return cachedAnchorDeps;
}

// ─── Anchor scheduler (every 5 minutes) ───────────────────────────────────────

export const anchorBatchScheduler = onSchedule(
  {
    schedule:       "every 5 minutes",
    timeZone:       "UTC",
    timeoutSeconds: 540,
    memory:         "512MiB",
    retryCount:     0,
  },
  async () => {
    await runAnchorBatchOnce(anchorDeps());
  },
);

// ─── Admin HTTP — POST /v1/admin/anchor/run ──────────────────────────────────

const adminApp = express();
adminApp.use(corsMiddleware);
adminApp.use(express.json());

// Lazy router so module load doesn't trip the prod-env check.
let cachedAdminRouter: express.Router | null = null;
adminApp.use("/v1/admin/anchor", (req, res, next) => {
  if (!cachedAdminRouter) {
    cachedAdminRouter = makeAnchorAdminRouter(anchorDeps());
  }
  cachedAdminRouter(req, res, next);
});

export const anchorAdmin = onRequest(
  { region: "us-central1", cors: false, memory: "256MiB" },
  adminApp,
);

// ─── Public verify endpoint (PFL-023) ────────────────────────────────────────
//
// The verify router owns its own CORS policy (Access-Control-Allow-Origin: *)
// because the verify endpoint is intentionally unauthenticated and meant
// to be called from any web client. We deliberately DO NOT install the
// allowlist `corsMiddleware` on this app — it would override the public-
// access policy with the smaller subdomain allowlist.

const publicApp = express();
publicApp.use(express.json());

let cachedVerifyRouter: express.Router | null = null;
function verifyRouter(): express.Router {
  if (cachedVerifyRouter) return cachedVerifyRouter;
  const firestore = getFirestore();
  // For verify (read-only), prefer the stub chain reader when anchor env
  // isn't wired. It reports "not anchored" rather than crashing — a
  // hackathon-grade graceful degrade.
  let chainReader;
  try {
    const deps = anchorDeps();
    chainReader = { readAnchor: deps.anchor.readAnchor.bind(deps.anchor) };
  } catch {
    const stub = makeStubAnchorProvider();
    chainReader = { readAnchor: stub.readAnchor.bind(stub) };
  }
  const service = makeVerifyService({ firestore, chainReader });
  cachedVerifyRouter = makeVerifyRouter({ service });
  return cachedVerifyRouter;
}

publicApp.use("/v1/verify", (req, res, next) => verifyRouter()(req, res, next));

// Liveness probe — useful for smoke tests / uptime checks without touching
// Firestore or the chain reader.
publicApp.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "proofline-api" });
});

export const api = onRequest(
  { region: "us-central1", cors: false, memory: "256MiB" },
  publicApp,
);

// ─── Factory kept for tests + future composition ─────────────────────────────

import type { Firestore } from "firebase-admin/firestore";
import type { AnchorProvider } from "@proofline/anchoring";

export interface AppDeps {
  firestore: Firestore;
  /** Read-only chain reader used by the verify endpoint. */
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

export function makeApp(deps: AppDeps): express.Express {
  // Mirrors `publicApp` above: no allowlist CORS middleware — the verify
  // router sets its own permissive headers because /v1/verify is intended
  // for unauthenticated cross-origin reads.
  const app = express();
  app.use(express.json());
  const verifyService = makeVerifyService(deps);
  app.use("/v1/verify", makeVerifyRouter({ service: verifyService }));
  return app;
}
