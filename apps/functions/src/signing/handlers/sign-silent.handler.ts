/**
 * @file sign-silent.handler.ts
 * @module apps/functions/src/signing
 *
 * POST /v1/sign-silent — In-session signing path (TDD §5.6, PRD §7.3).
 *
 * Called by the extension's background service worker when:
 *   - Sarah composes a REPLY to a recipient with whom she has an ACTIVE session
 *   - The email is not a high-value wire (F-SES-07 — those get fresh path)
 *
 * Flow:
 *   1. Parse + validate request body.
 *   2. Verify JWS signature on the session token (fast — no DB read yet).
 *   3. Run validatePolicy() FULL pipeline (F-SIG-11).
 *      — Stage 1 re-fetches session record from Firestore and checks:
 *          active, not-expired, correct scope, hard cap
 *      — Stages 2–7 run regardless of session state
 *   4. Build a WebAuthn challenge (sha256 of canonical payload).
 *      userVerification: "discouraged" — silent popup, no biometric prompt.
 *   5. Store pending-challenge record (90 s TTL).
 *   6. Return challenge to extension.
 *
 * The extension opens a MINIMIZED popup on proofline.app/sign/silent,
 * which runs navigator.credentials.get({userVerification:"discouraged"}),
 * posts the assertion back, and calls POST /v1/sign/finalize with path="silent".
 *
 * Auth: Bearer extension auth token (validated by middleware).
 */

import * as express from "express";
import { v7 as uuidv7 } from "uuid";

import { validatePolicy } from "@proofline/policy";
import {
  PolicyContext,
  SessionTokenPayload,
  SignSilentRequest,
  SignSilentRequestSchema,
  SignSilentResponse,
  WebAuthnChallenge,
} from "@proofline/types";
import {
  buildCanonicalBytes,
  storePendingChallenge,
  verifySessionTokenJWS,
} from "./signing.helpers.js";
import { makeRFC7807Error } from "./http.helpers.js";

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeSignSilentHandler(ctx: PolicyContext) {
  return async function signSilentHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse body ─────────────────────────────────────────────────────────

    const parseResult = SignSilentRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(
        makeRFC7807Error("about:blank", "Bad Request", 400, parseResult.error.message)
      );
      return;
    }

    const body: SignSilentRequest = parseResult.data;
    const { userId, companyId } = (req as any).user as {
      userId: string;
      companyId: string;
    };

    // ── 2. JWS signature check on session token ───────────────────────────────
    //
    // Fast cryptographic verification (no DB read) that the token was issued
    // by ProofLine and hasn't been tampered with.
    // We do NOT trust the token for policy decisions — see validatePolicy Stage 1.

    let parsedSessionToken: SessionTokenPayload;
    try {
      parsedSessionToken = await verifySessionTokenJWS(body.sessionToken);
    } catch {
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/SESSION_INVALID",
          "SESSION_INVALID",
          401,
          "Session token JWS verification failed"
        )
      );
      return;
    }

    // ── 3. Compute payload hash ───────────────────────────────────────────────

    const canonicalBytes = buildCanonicalBytes(body.payload);

    // ── 4. Run FULL policy pipeline (F-SIG-11) ────────────────────────────────
    //
    // INVARIANT: We never issue a challenge if this returns { ok: false }.
    //            In particular:
    //              - HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC fires when the email
    //                is a wire instruction above the company threshold (F-SES-07)
    //              - SESSION_EXPIRED fires when expiresAt < now or hard cap hit
    //              - ROLE_INVALID fires when user's role changed mid-session
    //              - ANOMALY_FLAGGED revokes the session and blocks the sign

    const policyResult = await validatePolicy(
      {
        payload: body.payload,
        payloadHash: Buffer.from(canonicalBytes).toString("hex"),
        recipientSetHash: body.recipientSetHash,
        userId,
        companyId,
        credentialId: body.credentialId,
        sessionToken: body.sessionToken,
        parsedSessionToken,
        freshBiometric: false,   // silent path — no fresh biometric
      },
      ctx
    );

    if (!policyResult.ok) {
      const { code, detail } = policyResult.error;
      const status = policyErrorToHttpStatus(code);
      res.status(status).json(
        makeRFC7807Error(`https://proofline.app/errors/${code}`, code, status, detail)
      );
      return;
    }

    // ── 5. Build silent WebAuthn challenge ────────────────────────────────────
    //
    // userVerification: "discouraged" — the OS treats a recent biometric
    // verification as still valid and returns an assertion without re-prompting.
    // The assertion is still a real ECDSA signature from the Secure Enclave.

    const challengeId = uuidv7();
    const challenge: WebAuthnChallenge = {
      challenge: Buffer.from(canonicalBytes).toString("base64url"),
      rpId: "proofline.app",
      allowCredentials: [{ type: "public-key", id: body.credentialId }],
      userVerification: "discouraged",  // ← the ONLY thing the session changes
      timeout: 30_000,                  // shorter — no user interaction needed
    };

    // ── 6. Store pending challenge ────────────────────────────────────────────

    const payloadHash = Buffer.from(canonicalBytes).toString("hex");
    await storePendingChallenge(challengeId, {
      payloadHash,
      recipientSetHash: body.recipientSetHash,
      credentialId: body.credentialId,
      userId,
      companyId,
      path: "silent",
      sessionId: parsedSessionToken.sessionId,
      expiresAt: ctx.now() + 30_000,
    });

    // ── 7. Return challenge ───────────────────────────────────────────────────

    const response: SignSilentResponse = {
      ok: true,
      challenge,
    };

    res.setHeader("X-ProofLine-Challenge-Id", challengeId);
    res.status(200).json(response);
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function policyErrorToHttpStatus(code: string): number {
  switch (code) {
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
    case "SESSION_REVOKED":
    case "SESSION_SCOPE_MISMATCH":
      return 401;
    case "HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC":
    case "FRESH_BIOMETRIC_REQUIRED":
      return 422;  // client must switch to fresh path
    case "USER_INACTIVE":
    case "ROLE_INVALID":
    case "DEVICE_INVALID":
    case "POLICY_COUNTERPARTY_DEACTIVATED":
    case "ANOMALY_FLAGGED":
    case "POLICY_DAILY_AGGREGATE_EXCEEDED":
    case "POLICY_AUTHORITY_EXCEEDED":
      return 403;
    default:
      return 500;
  }
}