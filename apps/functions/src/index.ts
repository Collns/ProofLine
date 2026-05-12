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
 *    - `webhooks` (HTTP): POST /webhooks/stripe-identity (PFL-013).
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

// --- PFL-013: Stripe Identity webhook
import { createStripeIdentityWebhookHandler } from "./webhooks/stripe-identity.js";

// --- PFL-060: signing + onboarding HTTP wiring
import type { PolicyContext } from "@proofline/types";
import { makeSignHandler }         from "./signing/handlers/sign.handler.js";
import { makeSignSilentHandler }   from "./signing/handlers/sign-silent.handler.js";
import { makeSignFinalizeHandler } from "./signing/handlers/sign-finalize.handler.js";
import { makeOnboardingRouter }    from "./api/onboarding/router.js";
import {
  makeStubOnboardingDeps,
  makeStubPolicyContext,
} from "./wiring/stubs.js";

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

// ─── PFL-060: signing routes (/v1/sign, /v1/sign-silent, /v1/sign/finalize) ─
//
// Mounted on the same `api` Function as /v1/verify so client integrators
// only need one base URL. CORS is route-scoped (allowlist) — public
// verify keeps its `*` policy, signing requires an allowlisted Origin.
//
// Auth is stubbed: we stamp `req.user` with a dev identity so the
// handlers can destructure `req.user` without crashing. Real Bearer-token
// validation lands once the extension auth ceremony issues server-side
// JWS (PFL-AUTH-LOGIN).
//
// PolicyContext is built PER REQUEST so getUser can return a user whose
// `devices[]` includes the credentialId from this request — without
// that, every sign attempt would 403 with DEVICE_INVALID.

function stubAuthMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
  // TODO(PFL-AUTH-LOGIN): verify the Bearer JWS and pull (userId, companyId)
  // from its payload. The header is read here so the var doesn't drop out
  // of the bundle's reachability graph once real auth is wired.
  const _bearer = typeof req.headers.authorization === "string"
    ? req.headers.authorization
    : "";
  void _bearer;
  (req as express.Request & { user: { userId: string; companyId: string } }).user = {
    userId:    "dev-user",
    companyId: "dev-company",
  };
  next();
}

type SignHandlerFactory = (
  ctx: PolicyContext,
) => (req: express.Request, res: express.Response) => Promise<void>;

function withPerRequestPolicyCtx(factory: SignHandlerFactory): express.RequestHandler {
  return async (req, res, next) => {
    const body = req.body as { credentialId?: unknown } | undefined;
    const credentialId = typeof body?.credentialId === "string"
      ? body.credentialId
      : "stub-credential-id";
    const user = (req as express.Request & {
      user?: { userId?: string; companyId?: string };
    }).user;
    const ctx = makeStubPolicyContext({
      credentialId,
      userId:    user?.userId    ?? "dev-user",
      companyId: user?.companyId ?? "dev-company",
    });
    try {
      await factory(ctx)(req, res);
    } catch (err) {
      next(err);
    }
  };
}

const signRouter = express.Router();
// All three signing endpoints share the same dispatch shape. /finalize
// is exposed BOTH at /v1/sign/finalize (legacy + ceremony URL) and as a
// sibling of /v1/sign so the original client paths keep working.
signRouter.post("/",         withPerRequestPolicyCtx(makeSignHandler));
signRouter.post("/finalize", withPerRequestPolicyCtx(makeSignFinalizeHandler));

publicApp.use("/v1/sign",        corsMiddleware, stubAuthMiddleware, signRouter);
publicApp.use("/v1/sign-silent", corsMiddleware, stubAuthMiddleware,
  withPerRequestPolicyCtx(makeSignSilentHandler));

// ─── PFL-060: onboarding routes (/v1/onboard/*) ──────────────────────────────
//
// All sub-routes (start, verify-dns, verify-email, verify-email-code, kyb,
// enroll-officer, finalize) are mounted via the existing router factory.
// Deps are stubbed (Middesk/Stripe/KMS/Resend) — see wiring/stubs.ts.

let cachedOnboardingRouter: express.Router | null = null;
function onboardingRouter(): express.Router {
  if (cachedOnboardingRouter) return cachedOnboardingRouter;
  cachedOnboardingRouter = makeOnboardingRouter(makeStubOnboardingDeps());
  return cachedOnboardingRouter;
}

publicApp.use(
  "/v1/onboard",
  corsMiddleware,
  stubAuthMiddleware,
  (req, res, next) => onboardingRouter()(req, res, next),
);

export const api = onRequest(
  { region: "us-central1", cors: false, memory: "256MiB" },
  publicApp,
);

// ─── Webhooks — PFL-013: Stripe Identity ─────────────────────────────────────
//
// IMPORTANT: express.raw() MUST come before express.json() on this app.
// Stripe's webhook signature check (stripe.webhooks.constructEvent) requires
// the raw request body as a Buffer. If express.json() runs first it replaces
// req.body with the parsed object and the HMAC check fails.
//
// This is a separate Firebase Function (webhooks) so the raw-body requirement
// doesn't bleed into the public API function above.

const webhooksApp = express();

// Raw body for Stripe signature verification — scoped to this route only.
webhooksApp.post(
  "/webhooks/stripe-identity",
  express.raw({ type: "application/json" }),
  (() => {
    let cachedHandler: ReturnType<typeof createStripeIdentityWebhookHandler> | null = null;
    return (req: express.Request, res: express.Response) => {
      if (!cachedHandler) {
        cachedHandler = createStripeIdentityWebhookHandler();
      }
      return cachedHandler(req, res);
    };
  })(),
);
 
export const webhooks = onRequest(
  { region: "us-central1", cors: false, memory: "256MiB" },
  webhooksApp,
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
