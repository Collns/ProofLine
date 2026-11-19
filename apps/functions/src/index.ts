/**
 * @file index.ts
 * @module apps/functions
 *
 * Firebase Functions entry point. Exports deployable handlers:
 *
 *   - `anchorBatchScheduler` (scheduled): runs every 5 minutes, drains
 *     anchor_queue, posts a Merkle root to Base Sepolia (PFL-027).
 *   - `anchorAdmin` (HTTP): POST /v1/admin/anchor/run (manual anchor
 *     trigger; auth lock-down tracked in PFL-170).
 *   - `api` (HTTP): public verify endpoint GET /v1/verify/:id (PFL-023).
 *
 *    - `webhooks` (HTTP): POST /webhooks/stripe-identity (PFL-013),
 *      POST /webhooks/baselayer (PFL-162).
 * Existing routers still pending HTTP wiring (live as code only):
 *   - /v1/onboard via api/onboarding/router.ts (PFL-017)
 *   - /v1/sign    via signing/handlers/* (PFL-021)
 *   - /v1/bilateral via api/bilateral/router.ts (PFL-025)
 *
 * Module-load principle:
 *   Anything that touches env-dependent config (anchor provider, chain
 *   reader, Firestore) is built LAZILY on the first request that needs
 *   it. This lets `firebase deploy` analyse the bundle even when secrets
 *   aren't present at build time.
 *
 * Configuration (PFL-169): loadConfig() validates PROOFLINE_ENV and the
 *   explicit *_PROVIDER selection once per instance. A misconfigured
 *   instance logs every problem and answers 503 CONFIG_INVALID on every
 *   request instead of falling back to stubs.
 */

import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

// Functions v2 secret binding: the three call sites that HMAC-verify the
// extension auth JWS (extension-auth.handler, register-credential.handler,
// require-extension-auth.middleware) all read process.env on each request.
// Without this binding the env var is undefined at runtime even when the
// secret is set via `firebase functions:secrets:set PROOFLINE_AUTH_JWT_SECRET`.
// Only the `api` export needs this — anchorAdmin/webhooks don't touch it.
const PROOFLINE_AUTH_JWT_SECRET = defineSecret("PROOFLINE_AUTH_JWT_SECRET");
// PFL-169: the bilateral link and cosign refresh secrets used to fall back
// to hardcoded strings because they were never bound. Bound here; readSecret
// throws if either is missing or shorter than 32 characters.
const BILATERAL_JWT_SECRET  = defineSecret("BILATERAL_JWT_SECRET");
const COSIGN_REFRESH_SECRET = defineSecret("COSIGN_REFRESH_SECRET");
// PFL-160: Resend API key for EMAIL_PROVIDER=resend. Bound as a secret so it
// never sits in a plain env file; create a placeholder value while stub.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// PFL-176: Stripe Identity keys. Read by the api (IDV_PROVIDER=stripe) and
// the webhooks function. Bound as secrets so they never sit in a plain env
// file; create placeholder values while IDV_PROVIDER=stub.
const STRIPE_SECRET_KEY              = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_IDENTITY_WEBHOOK_SECRET = defineSecret("STRIPE_IDENTITY_WEBHOOK_SECRET");
// PFL-162: KYB vendor keys. The api reads the selected one (KYB_PROVIDER);
// the webhooks function verifies Baselayer's Svix signature. Create
// placeholder values for the unused ones while KYB_PROVIDER=stub.
const BASELAYER_API_KEY        = defineSecret("BASELAYER_API_KEY");
const BASELAYER_WEBHOOK_SECRET = defineSecret("BASELAYER_WEBHOOK_SECRET");
const COBALT_API_KEY           = defineSecret("COBALT_API_KEY");
// PFL-028: Gemini key for AI_PROVIDER=gemini (advisory wire memo screening).
// Create a placeholder value while AI_PROVIDER is heuristic or none.
const GEMINI_API_KEY           = defineSecret("GEMINI_API_KEY");
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";


import {
  makeAnchorAdminRouter,
  makeAnchorRunDeps,
  runAnchorBatchOnce,
} from "./anchoring/index.js";

// --- PFL-169: explicit, fail-closed configuration
import { loadConfig, describeConfig, ConfigError, type AppConfig } from "./config/config.js";
import { assertSecrets, API_SECRETS } from "./config/secrets.js";
import { makeEmailProvider, makeOnboardingDeps, makeScreener } from "./wiring/providers.js";
import type { EmailProvider } from "@proofline/email";
import type { MemoScreener } from "@proofline/ai";
import type { RunAnchorDeps } from "./anchoring/index.js";

import { makeVerifyRouter, makeVerifyService } from "./verify/index.js";

// --- PFL-013: Stripe Identity webhook
import { createStripeIdentityWebhookHandler } from "./webhooks/stripe-identity.js";
// --- PFL-162: Baselayer KYB webhook (late IRS / registry results)
import { makeBaselayerWebhookHandler } from "./webhooks/baselayer.js";

// --- PFL-060: signing + onboarding HTTP wiring
import type { PolicyContext } from "@proofline/types";
import { makeSignHandler }         from "./signing/handlers/sign.handler.js";
import { makeSignStatusHandler }   from "./signing/handlers/sign-status.handler.js";
import { makeSignSilentHandler }   from "./signing/handlers/sign-silent.handler.js";
import { makeSignFinalizeHandler } from "./signing/handlers/sign-finalize.handler.js";
import { makeOnboardingRouter }    from "./api/onboarding/router.js";
import { makeFirestorePolicyContext } from "./wiring/firestore-policy-context.js";

// --- PFL-025: bilateral HTTP wiring
import { makeBilateralRouter }         from "./api/bilateral/router.js";
import { makeBilateralService }        from "@proofline/bilateral";
import { makeFirestoreBilateralStore } from "./api/bilateral/firestore-store.js";

// --- PFL-061: extension auth HTTP wiring
import { makeExtensionAuthHandler } from "./auth/extension-auth.handler.js";

// --- PFL-069: WebAuthn credential registration
import { makeRegisterCredentialHandler } from "./auth/register-credential.handler.js";

// --- PFL-095: server-issued WebAuthn registration challenges
import { makeRegistrationChallengeHandler } from "./auth/registration-challenge.handler.js";

// --- PFL-068: employee invitations (owner/manager → invitee linking)
import { makeInviteEmployeeHandler } from "./auth/invite-employee.handler.js";

// --- PFL-085: multi-device management (revoke a specific device)
import { makeRevokeDeviceHandler } from "./auth/revoke-device.handler.js";

// --- PFL-128: user management (owner/manager only)
import { makeUpdateRoleHandler   } from "./auth/update-role.handler.js";
import { makeUpdateStatusHandler } from "./auth/update-status.handler.js";
import { makeRevokeSessionHandler } from "./auth/revoke-session.handler.js";

// --- PFL-127: admin API (Firebase Auth-scoped read endpoints)
import { adminAuthMiddleware } from "./auth/admin-auth.middleware.js";
import {
  makeCompanyHandler,
  makeUsersHandler,
  makeSignedMessagesHandler,
  makeSessionsHandler,
  makeInvitationsHandler,
} from "./api/admin/handlers.js";

// --- PFL-087: real Bearer auth for signing routes
import { requireExtensionAuth } from "./auth/require-extension-auth.middleware.js";

// --- PFL-166: Firebase ID-token auth for onboarding + bilateral
import { makeFirebaseAuth } from "./auth/firebase-auth.middleware.js";
// --- PFL-026: counterparty invitations
import { makeInvitationService } from "@proofline/invitations";
import { makeInvitationsRouter } from "./api/invitations/router.js";
import { makeFirestoreInvitationStore } from "./api/invitations/firestore-store.js";

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
  // DELETE: web-admin cancels a counterparty invitation (PFL-026).
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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

// ─── Configuration (PFL-169) ──────────────────────────────────────────────────

let cachedConfig: AppConfig | null = null;
let configFailureLogged = false;

/** Validated config; throws ConfigError (logged once per instance). */
function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  try {
    cachedConfig = loadConfig(process.env);
  } catch (err) {
    if (!configFailureLogged) {
      configFailureLogged = true;
      console.error(JSON.stringify({
        level: "error",
        event: "config.invalid",
        problems: err instanceof ConfigError ? err.problems : [String(err)],
      }));
    }
    throw err;
  }
  console.info(JSON.stringify({ level: "info", event: "config.loaded", ...describeConfig(cachedConfig) }));
  return cachedConfig;
}

/**
 * Express guard: refuses every request while the instance is
 * misconfigured. `secrets` lists the Functions secrets this app needs.
 */
function configGuard(secrets: readonly (typeof API_SECRETS)[number][] = []): express.RequestHandler {
  let secretsFailureLogged = false;
  return (_req, res, next) => {
    try {
      getConfig();
      try {
        assertSecrets(secrets);
      } catch (err) {
        if (!secretsFailureLogged) {
          secretsFailureLogged = true;
          console.error(JSON.stringify({
            level: "error",
            event: "config.invalid",
            problems: err instanceof ConfigError ? err.problems : [String(err)],
          }));
        }
        throw err;
      }
    } catch {
      res.status(503).json({
        error: { code: "CONFIG_INVALID", message: "Service is not configured correctly." },
      });
      return;
    }
    next();
  };
}

// ─── Lazy dependency factory ──────────────────────────────────────────────────

let cachedAnchorDeps: RunAnchorDeps | null = null;
function anchorDeps(): RunAnchorDeps {
  if (cachedAnchorDeps) return cachedAnchorDeps;
  cachedAnchorDeps = makeAnchorRunDeps(getConfig());
  return cachedAnchorDeps;
}

/** Base URL of the counterparty portal (web-counterparty): bilateral documents. */
function counterpartyPortalBaseUrl(): string {
  return process.env["COUNTERPARTY_PORTAL_URL"]?.trim() || "https://proofline-counterparty.web.app";
}

/** Base URL of the sign app (web-sign): cosign approval page (PFL-136). */
function signAppBaseUrl(): string {
  return process.env["SIGN_APP_URL"]?.trim() || "https://proofline-sign.web.app";
}

let cachedEmailProvider: EmailProvider | null = null;
function emailProvider(): EmailProvider {
  if (cachedEmailProvider) return cachedEmailProvider;
  cachedEmailProvider = makeEmailProvider(getConfig());
  return cachedEmailProvider;
}

let cachedScreener: MemoScreener | null = null;
function memoScreener(): MemoScreener {
  if (cachedScreener) return cachedScreener;
  cachedScreener = makeScreener(getConfig());
  return cachedScreener;
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
adminApp.use(configGuard());
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
publicApp.use(configGuard(API_SECRETS));
publicApp.use(express.json());

let cachedVerifyRouter: express.Router | null = null;
function verifyRouter(): express.Router {
  if (cachedVerifyRouter) return cachedVerifyRouter;
  const firestore = getFirestore();
  // PFL-169: the chain reader comes from the selected anchor provider;
  // no silent stub fallback.
  const { anchor } = anchorDeps();
  const chainReader = { readAnchor: anchor.readAnchor.bind(anchor) };
  const service = makeVerifyService({ firestore, chainReader });
  cachedVerifyRouter = makeVerifyRouter({ service });
  return cachedVerifyRouter;
}

publicApp.use("/v1/verify", (req, res, next) => verifyRouter()(req, res, next));

publicApp.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "proofline-api" });
});

// ─── Auth ────────────────────────────────────────────────────────────────────
//
// `requireExtensionAuth` (PFL-087) decodes the JWS Bearer issued by
// /v1/extension/auth and sets req.user from the real Firebase UID. It's
// mounted on the signing routes below — which is the chain that feeds
// PolicyContext.getUser(userId) → users/{realUID} → devices[].
//
// PFL-166: /v1/onboard requires a verified Firebase ID token (the caller
// may not belong to a company yet). /v1/bilateral accepts an optional
// Firebase ID token for an active company user; drafter routes require
// it, counterparty routes authenticate with the signed deep-link token.

const onboardingAuth = makeFirebaseAuth({ requireCompany: false });
const bilateralAuth  = makeFirebaseAuth({ requireCompany: true, optional: true });

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
    // requireExtensionAuth always sets req.user; refuse rather than invent
    // an identity if that ever changes.
    if (!user?.userId || !user.companyId) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing authenticated user" } });
      return;
    }
    const ctx = makeFirestorePolicyContext(getFirestore(), {
      userId:    user.userId,
      companyId: user.companyId,
    });
    try {
      await factory(ctx)(req, res);
    } catch (err) {
      next(err);
    }
  };
}

const signRouter = express.Router();
// PFL-028: wire instructions get advisory memo screening (AI_PROVIDER).
signRouter.post("/",         withPerRequestPolicyCtx((ctx) => makeSignHandler(ctx, { screener: memoScreener() })));
// PFL-136: over-limit wires are recorded PENDING_COSIGN and the approvers
// are emailed a link to the web-sign approval page.
signRouter.post("/finalize", withPerRequestPolicyCtx((ctx) => makeSignFinalizeHandler(ctx, {
  signAppBaseUrl: signAppBaseUrl(),
  sendCosignRequest: (to, wire, link) => emailProvider().sendCosignRequest(to, wire, link),
})));
signRouter.get("/status/:envelopeId", (req, res, next) => {
  makeSignStatusHandler()(req, res).catch(next);
});

publicApp.use("/v1/sign",        corsMiddleware, requireExtensionAuth, signRouter);
publicApp.use("/v1/sign-silent", corsMiddleware, requireExtensionAuth,
  withPerRequestPolicyCtx(makeSignSilentHandler));

// ─── Onboarding routes (/v1/onboard/*) ───────────────────────────────────────

let cachedOnboardingRouter: express.Router | null = null;
function onboardingRouter(): express.Router {
  if (cachedOnboardingRouter) return cachedOnboardingRouter;
  cachedOnboardingRouter = makeOnboardingRouter(
    makeOnboardingDeps(getConfig(), { email: emailProvider(), anchor: anchorDeps().anchor }),
  );
  return cachedOnboardingRouter;
}

publicApp.use(
  "/v1/onboard",
  corsMiddleware,
  onboardingAuth,
  (req, res, next) => onboardingRouter()(req, res, next),
);

// ─── PFL-025: Bilateral routes (/v1/bilateral/*) ─────────────────────────────
//
// sign-as-counterparty is auth'd by the JWS token in the request header
// rather than a Bearer token, so bilateralAuth is optional at the mount
// and the router enforces a company user on the drafter routes.
// X-ProofLine-Bilateral-Token is added to the CORS allow-headers above.

let cachedBilateralRouter: express.Router | null = null;
function bilateralRouter(): express.Router {
  if (cachedBilateralRouter) return cachedBilateralRouter;
  cachedBilateralRouter = makeBilateralRouter({
    bilateralService: makeBilateralService({
      store: makeFirestoreBilateralStore(),
      now:   () => Math.floor(Date.now() / 1000),
    }),
    email: emailProvider(),
    counterpartyPortalBaseUrl: counterpartyPortalBaseUrl(),
  });
  return cachedBilateralRouter;
}

publicApp.use(
  "/v1/bilateral",
  corsMiddleware,
  bilateralAuth,
  (req, res, next) => bilateralRouter()(req, res, next),
);

// ─── PFL-026: Counterparty invitations (/v1/invitations/*) ───────────────────
//
// Firebase ID token with a company (makeFirebaseAuth); the router itself
// requires owner/manager on a verified company and scopes every lookup to
// the caller's companyId. Invite-link email delivery is PFL-132, so no
// `deliver` is wired yet: invitations are recorded but not emailed.

const invitationsAuth = makeFirebaseAuth({ requireCompany: true });

let cachedInvitationsRouter: express.Router | null = null;
function invitationsRouter(): express.Router {
  if (cachedInvitationsRouter) return cachedInvitationsRouter;
  const firestore = getFirestore();
  cachedInvitationsRouter = makeInvitationsRouter({
    service: makeInvitationService({ store: makeFirestoreInvitationStore(firestore) }),
    async loadCompany(companyId) {
      const snap = await firestore.collection("companies").doc(companyId).get();
      if (!snap.exists) return null;
      const c = snap.data() as { legalName?: string; domain?: string; status?: string };
      return { legalName: c.legalName ?? "", domain: c.domain ?? "", ...(c.status ? { status: c.status } : {}) };
    },
  });
  return cachedInvitationsRouter;
}

publicApp.use(
  "/v1/invitations",
  corsMiddleware,
  invitationsAuth,
  (req, res, next) => invitationsRouter()(req, res, next),
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
// handler decodes it locally (HS256, PROOFLINE_AUTH_JWT_SECRET).

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

// PFL-095: server-issued WebAuthn registration challenges. The popup
// calls this BEFORE running navigator.credentials.create() and then
// posts the resulting attestation (carrying the same challenge in
// clientDataJSON) to /v1/extension/register-credential, where the
// challenge is single-use consumed.
let cachedRegistrationChallengeHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function registrationChallengeHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedRegistrationChallengeHandler) return cachedRegistrationChallengeHandler;
  cachedRegistrationChallengeHandler = makeRegistrationChallengeHandler();
  return cachedRegistrationChallengeHandler;
}

publicApp.post(
  "/v1/auth/challenge",
  corsMiddleware,
  (req, res, next) => {
    registrationChallengeHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/auth/challenge", corsMiddleware);

// PFL-068: invite an employee (owner/manager only). Auth is a Firebase
// ID token Bearer — the handler enforces role + companyId via the
// caller's users/{uid} doc, so a client claiming a role they don't
// have in Firestore is rejected.
let cachedInviteEmployeeHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function inviteEmployeeHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedInviteEmployeeHandler) return cachedInviteEmployeeHandler;
  cachedInviteEmployeeHandler = makeInviteEmployeeHandler();
  return cachedInviteEmployeeHandler;
}

publicApp.post(
  "/v1/admin/invite-employee",
  corsMiddleware,
  (req, res, next) => {
    inviteEmployeeHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/admin/invite-employee", corsMiddleware);

// PFL-085: revoke an individual WebAuthn credential. Auth is the same
// extension JWS Bearer the rest of /v1/extension/* uses; the handler
// enforces self-or-(owner|manager)-same-company via the users doc.
let cachedRevokeDeviceHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function revokeDeviceHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedRevokeDeviceHandler) return cachedRevokeDeviceHandler;
  cachedRevokeDeviceHandler = makeRevokeDeviceHandler();
  return cachedRevokeDeviceHandler;
}

publicApp.post(
  "/v1/admin/revoke-device",
  corsMiddleware,
  (req, res, next) => {
    revokeDeviceHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/admin/revoke-device", corsMiddleware);

// PFL-128: change a user's role (owner only) and status (owner/manager).
// Both endpoints verify the Firebase ID token Bearer themselves and
// enforce caller authorization against the persisted users/{uid} doc;
// they intentionally don't share the GET-only adminAuthMiddleware below
// so each handler can keep its own audit-log shape.
let cachedUpdateRoleHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function updateRoleHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedUpdateRoleHandler) return cachedUpdateRoleHandler;
  cachedUpdateRoleHandler = makeUpdateRoleHandler();
  return cachedUpdateRoleHandler;
}

publicApp.post(
  "/v1/admin/update-role",
  corsMiddleware,
  (req, res, next) => {
    updateRoleHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/admin/update-role", corsMiddleware);

let cachedUpdateStatusHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function updateStatusHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedUpdateStatusHandler) return cachedUpdateStatusHandler;
  cachedUpdateStatusHandler = makeUpdateStatusHandler();
  return cachedUpdateStatusHandler;
}

publicApp.post(
  "/v1/admin/update-status",
  corsMiddleware,
  (req, res, next) => {
    updateStatusHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/admin/update-status", corsMiddleware);

// PFL-130: revoke a single active signing session. Same Firebase ID
// token Bearer + self-verified authorization pattern as update-status.
let cachedRevokeSessionHandler:
  | ((req: express.Request, res: express.Response) => Promise<void>)
  | null = null;
function revokeSessionHandler(): (
  req: express.Request,
  res: express.Response,
) => Promise<void> {
  if (cachedRevokeSessionHandler) return cachedRevokeSessionHandler;
  cachedRevokeSessionHandler = makeRevokeSessionHandler();
  return cachedRevokeSessionHandler;
}

publicApp.post(
  "/v1/admin/revoke-session",
  corsMiddleware,
  (req, res, next) => {
    revokeSessionHandler()(req, res).catch(next);
  },
);
publicApp.options("/v1/admin/revoke-session", corsMiddleware);

// ─── PFL-127: admin read API (/v1/admin/{company,users,signed-messages,sessions,invitations}) ─
//
// Sub-router because every endpoint needs the same Firebase Auth Bearer
// middleware. CORS still applies at the outer publicApp level via
// corsMiddleware. The deps factory is lazy because getFirestore() needs
// firebase-admin to be initialised — which happens at module load above.
let cachedAdminApiRouter: express.Router | null = null;
function adminApiRouter(): express.Router {
  if (cachedAdminApiRouter) return cachedAdminApiRouter;
  const router = express.Router();
  const deps   = { getFirestore: () => getFirestore() };
  router.use(adminAuthMiddleware);
  const wrap =
    (factory: (d: typeof deps) => (req: express.Request, res: express.Response) => Promise<void>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      factory(deps)(req, res).catch(next);
    };
  router.get("/company",         wrap(makeCompanyHandler));
  router.get("/users",           wrap(makeUsersHandler));
  router.get("/signed-messages", wrap(makeSignedMessagesHandler));
  router.get("/sessions",        wrap(makeSessionsHandler));
  router.get("/invitations",     wrap(makeInvitationsHandler));
  cachedAdminApiRouter = router;
  return cachedAdminApiRouter;
}

// The outer corsMiddleware here short-circuits OPTIONS preflights for
// every nested /v1/admin/* route — no need for an extra app.options()
// registration. The POST endpoints registered above (invite-employee,
// revoke-device) are matched first by Express, so they aren't shadowed
// by the GET-only sub-router below.
publicApp.use(
  "/v1/admin",
  corsMiddleware,
  (req, res, next) => adminApiRouter()(req, res, next),
);

// ─── PFL-062: Cosign routes (/v1/cosign/*) ───────────────────────────────────
//
// Public endpoints — the signed JWS in the URL (or X-ProofLine-Cosign-Token
// header) is the auth. The approval page is web-sign (PFL-136), which is in
// the shared ALLOWED_ORIGINS set above.

let cachedCosignRouter: express.Router | null = null;
function cosignRouter(): express.Router {
  if (cachedCosignRouter) return cachedCosignRouter;
  // PFL-160: fresh cosign links go to the stored approvers via the
  // configured email provider.
  const email = emailProvider();
  cachedCosignRouter = makeCosignRouter({
    refresh: {
      portalBaseUrl: signAppBaseUrl(),
      sendFreshLinkEmail: async ({ to, link, wire }) => {
        await email.sendCosignRequest(
          to,
          {
            amount:                wire?.amountUsd ?? 0, // whole US dollars
            recipientAccountLast4: wire?.recipientAccountLast4 ?? "",
            routingNumber:         wire?.routingNumber ?? "",
            ...(wire?.memo ? { memo: wire.memo } : {}),
          },
          link,
        );
      },
    },
  });
  return cachedCosignRouter;
}

publicApp.use(
  "/v1/cosign",
  corsMiddleware,
  (req, res, next) => cosignRouter()(req, res, next),
);

export const api = onRequest(
  {
    region:  "us-central1",
    cors:    false,
    memory:  "256MiB",
    secrets: [
      PROOFLINE_AUTH_JWT_SECRET, BILATERAL_JWT_SECRET, COSIGN_REFRESH_SECRET,
      STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET, RESEND_API_KEY,
      BASELAYER_API_KEY, COBALT_API_KEY, GEMINI_API_KEY,
    ],
  },
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

// PFL-162: Baselayer delivers late KYB results (BusinessSearch.*) via Svix.
webhooksApp.post(
  "/webhooks/baselayer",
  express.raw({ type: "application/json" }),
  (() => {
    let cachedHandler: ReturnType<typeof makeBaselayerWebhookHandler> | null = null;
    return (req: express.Request, res: express.Response) => {
      if (process.env.KYB_PROVIDER?.trim() !== "baselayer") {
        res.status(404).json({ error: "Baselayer webhook is not enabled (KYB_PROVIDER)" });
        return;
      }
      const secret = process.env.BASELAYER_WEBHOOK_SECRET?.trim();
      if (!secret) {
        res.status(503).json({ error: "BASELAYER_WEBHOOK_SECRET is not set" });
        return;
      }
      if (!cachedHandler) {
        cachedHandler = makeBaselayerWebhookHandler({ firestore: getFirestore(), webhookSecret: secret });
      }
      return cachedHandler(req, res);
    };
  })(),
);

export const webhooks = onRequest(
  {
    region:  "us-central1",
    cors:    false,
    memory:  "256MiB",
    secrets: [STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET, BASELAYER_WEBHOOK_SECRET],
  },
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