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
 *   - /v1/bilateral via api/bilateral/router.ts (PFL-025)
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
import { makeStubOnboardingDeps } from "./wiring/stubs.js";
import { makeFirestorePolicyContext } from "./wiring/firestore-policy-context.js";

// --- PFL-025: bilateral HTTP wiring
import { makeBilateralRouter }         from "./api/bilateral/router.js";
import { makeBilateralService }        from "@proofline/bilateral";
import { makeFirestoreBilateralStore } from "./api/bilateral/firestore-store.js";
import { makeStubEmailProvider } from "@proofline/email/stub";

// --- PFL-061: extension auth HTTP wiring
import { makeExtensionAuthHandler } from "./auth/extension-auth.handler.js";

// --- PFL-069: WebAuthn credential registration
import { makeRegisterCredentialHandler } from "./auth/register-credential.handler.js";

// --- PFL-062: cosign HTTP wiring
import { makeCosignRouter } from "./cosign/router.js";

// ─── Firebase Admin (idempotent — module may be re-imported across invokes) ─

if (getApps().length === 0) {
  initializeApp();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://proofline-sign.web.app",
  "https://proofline-counterparty.web.app",
  "https://proofline-verify.web.app",
  "https://proofline-admin.web.app",
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
    "Authorization, Content-Type, X-ProofLine-Challenge-Id, X-ProofLine-Bilateral-Token, X-ProofLine-Cosign-Token",
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

// ─── Lazy dependency factory ──────────────────────────────────────────────────

let cachedAnchorDeps: RunAnchorDeps | null = null;
function anchorDeps(): RunAnchorDeps {
  if (cachedAnchorDeps) return cachedAnchorDeps;
  cachedAnchorDeps = makeAnchorRunDeps();
  return cachedAnchorDeps;
}

// ─── Anchor scheduler (every 5 minutes) ──────────────────────────────────────

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

// ─── Admin HTTP — POST /v1/admin/anchor/run ───────────────────────────────────

const adminApp = express();
adminApp.use(corsMiddleware);
adminApp.use(express.json());

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

// ─── Public API (verify + sign + onboard + bilateral) ────────────────────────

const publicApp = express();
publicApp.use(express.json());

let cachedVerifyRouter: express.Router | null = null;
function verifyRouter(): express.Router {
  if (cachedVerifyRouter) return cachedVerifyRouter;
  const firestore = getFirestore();
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

publicApp.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "proofline-api" });
});

// ─── Auth stub ────────────────────────────────────────────────────────────────

function stubAuthMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
): void {
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

// ─── Signing routes (/v1/sign, /v1/sign-silent, /v1/sign/finalize) ───────────

type SignHandlerFactory = (
  ctx: PolicyContext,
) => (req: express.Request, res: express.Response) => Promise<void>;

function withPerRequestPolicyCtx(factory: SignHandlerFactory): express.RequestHandler {
  return async (req, res, next) => {
    // PFL-086: PolicyContext now reads `users/{userId}` from Firestore for
    // the device check. The body-derived credentialId fallback that the
    // stub used is gone — validatePolicy / sign-finalize match against the
    // pending_challenges record, not against per-request body fields.
    const user = (req as express.Request & {
      user?: { userId?: string; companyId?: string };
    }).user;
    const ctx = makeFirestorePolicyContext(getFirestore(), {
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
signRouter.post("/",         withPerRequestPolicyCtx(makeSignHandler));
signRouter.post("/finalize", withPerRequestPolicyCtx(makeSignFinalizeHandler));

publicApp.use("/v1/sign",        corsMiddleware, stubAuthMiddleware, signRouter);
publicApp.use("/v1/sign-silent", corsMiddleware, stubAuthMiddleware,
  withPerRequestPolicyCtx(makeSignSilentHandler));

// ─── Onboarding routes (/v1/onboard/*) ───────────────────────────────────────

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

// ─── PFL-025: Bilateral routes (/v1/bilateral/*) ─────────────────────────────
//
// sign-as-counterparty is auth'd by the JWS token in the request header
// rather than a Bearer token — stubAuthMiddleware is a pass-through so it
// won't block it. X-ProofLine-Bilateral-Token is added to the CORS
// allow-headers above.

let cachedBilateralRouter: express.Router | null = null;
function bilateralRouter(): express.Router {
  if (cachedBilateralRouter) return cachedBilateralRouter;
  cachedBilateralRouter = makeBilateralRouter({
    bilateralService: makeBilateralService({
      store: makeFirestoreBilateralStore(),
      now:   () => Math.floor(Date.now() / 1000),
    }),
    email: makeStubEmailProvider(),
    counterpartyPortalBaseUrl:
      process.env["COUNTERPARTY_PORTAL_URL"]
      ?? "https://counterparty.proofline.web.app",
  });
  return cachedBilateralRouter;
}

publicApp.use(
  "/v1/bilateral",
  corsMiddleware,
  stubAuthMiddleware,
  (req, res, next) => bilateralRouter()(req, res, next),
);

// ─── PFL-061: Extension auth (POST /v1/extension/auth) ───────────────────────
//
// Public endpoint — no Bearer token required. The Firebase ID token in the
// request body IS the authentication. CORS is applied so the popup at
// https://proofline-sign.web.app can call it from the browser.

let cachedExtAuthHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function extensionAuthHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedExtAuthHandler) return cachedExtAuthHandler;
  cachedExtAuthHandler = makeExtensionAuthHandler();
  return cachedExtAuthHandler;
}

publicApp.post(
  "/v1/extension/auth",
  corsMiddleware,
  (req, res, next) => {
    extensionAuthHandler()(req, res).catch(next);
  },
);
// Explicit OPTIONS — corsMiddleware short-circuits the preflight, but the
// route must exist so Express doesn't fall through to a 404.
publicApp.options("/v1/extension/auth", corsMiddleware);

// ─── PFL-069: WebAuthn credential registration ───────────────────────────────
//
// Authenticated via the Bearer JWS issued by /v1/extension/auth — the
// handler decodes it locally (HS256, EXT_AUTH_JWT_SECRET) rather than going
// through stubAuthMiddleware, which lies and always returns the dev user.

let cachedRegisterCredHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function registerCredentialHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedRegisterCredHandler) return cachedRegisterCredHandler;
  cachedRegisterCredHandler = makeRegisterCredentialHandler();
  return cachedRegisterCredHandler;
}

publicApp.post(
  "/v1/extension/register-credential",
  corsMiddleware,
  (req, res, next) => {
    registerCredentialHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/extension/register-credential", corsMiddleware);

// ─── PFL-062: Cosign routes (/v1/cosign/*) ───────────────────────────────────
//
// Public endpoints — the JWS in the URL (or X-ProofLine-Cosign-Token header)
// is the auth. CORS allows proofline-counterparty.web.app, which is in the
// shared ALLOWED_ORIGINS set above.

let cachedCosignRouter: express.Router | null = null;
function cosignRouter(): express.Router {
  if (cachedCosignRouter) return cachedCosignRouter;
  cachedCosignRouter = makeCosignRouter();
  return cachedCosignRouter;
}

publicApp.use(
  "/v1/cosign",
  corsMiddleware,
  (req, res, next) => cosignRouter()(req, res, next),
);

export const api = onRequest(
  { region: "us-central1", cors: false, memory: "256MiB" },
  publicApp,
);

// ─── Webhooks — PFL-013: Stripe Identity ─────────────────────────────────────

const webhooksApp = express();

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

// ─── Factory kept for tests + future composition ──────────────────────────────

import type { Firestore } from "firebase-admin/firestore";
import type { AnchorProvider } from "@proofline/anchoring";

export interface AppDeps {
  firestore: Firestore;
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

export function makeApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json());
  const verifyService = makeVerifyService(deps);
  app.use("/v1/verify", makeVerifyRouter({ service: verifyService }));
  return app;
}