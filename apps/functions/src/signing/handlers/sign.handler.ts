/**
 * @file sign.handler.ts
 * @module apps/functions/src/signing
 *
 * POST /v1/sign — Fresh-biometric signing path.
 *
 * Flow (TDD §5.5, PRD §7.2):
 *   1. Parse + validate request body.
 *   2. Run validatePolicy() FULL pipeline (F-SIG-11).
 *   3. If COSIGN_REQUIRED → return that decision (no challenge).
 *   4. Build a WebAuthn challenge (sha256 of canonical payload bytes).
 *   5. Store a pending-challenge record in Firestore (nonce, payloadHash,
 *      expiry = 90 s) for finalize to verify against.
 *   6. Return challenge to extension.
 *
 * The extension opens a popup on proofline.app/sign/start,
 * the popup runs navigator.credentials.get(), gets an assertion,
 * then calls POST /v1/sign/finalize.
 *
 * Auth: Bearer extension auth token (validated by middleware before
 * this handler is reached).
 */

import * as express from "express";
import { v7 as uuidv7 } from "uuid";

import { validatePolicy } from "@proofline/policy";
import {
  PolicyContext,
  SignRequest,
  SignRequestSchema,
  SignResponse,
  WebAuthnChallenge,
} from "@proofline/types";
import {
  buildCanonicalBytes,
  hashPayload,
  resolveEligibleCosigners,
  storePendingChallenge,
} from "./signing.helpers.js";
import { makeRFC7807Error } from "./http.helpers.js";
// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeSignHandler(ctx: PolicyContext) {
  return async function signHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse body ────────────────────────────────────────────────────────

    const parseResult = SignRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(
        makeRFC7807Error(
          "about:blank",
          "Bad Request",
          400,
          parseResult.error.message
        )
      );
      return;
    }

    const body: SignRequest = parseResult.data;

    // Caller identity comes from the validated extension auth token
    // (middleware sets req.user).
    const { userId, companyId } = (req as any).user as {
      userId: string;
      companyId: string;
    };

    // ── 2. Compute payload hash ───────────────────────────────────────────────

    const canonicalBytes = buildCanonicalBytes(body.payload);
    const payloadHash = hashPayload(canonicalBytes);

    // ── 3. Run FULL policy pipeline (F-SIG-11) ────────────────────────────────
    //
    // INVARIANT: We never reach step 4 if this returns { ok: false }.
    //

    const policyResult = await validatePolicy(
      {
        payload: body.payload,
        payloadHash,
        recipientSetHash: body.recipientSetHash,
        userId,
        companyId,
        credentialId: body.credentialId,
        freshBiometric: true,
        cosignSignatures: body.cosignSignatures,
        // No sessionToken on the fresh path
      },
      ctx
    );

    if (!policyResult.ok) {
      const { code, detail } = policyResult.error;
      res.status(policyErrorToHttpStatus(code)).json(
        makeRFC7807Error(
          `https://proofline.app/errors/${code}`,
          code,
          policyErrorToHttpStatus(code),
          detail
        )
      );
      return;
    }

    // ── 4. COSIGN_REQUIRED shortcircuit ───────────────────────────────────────
    // Policy approved but requiring cosigners → no challenge issued yet.
    // Client will gather cosign signatures, then re-call /v1/sign.

    if (policyResult.value.decision === "COSIGN_REQUIRED") {
      const approvers = await resolveEligibleCosigners(companyId, ctx);
      const response: SignResponse = {
        ok: true,
        policyDecision: "COSIGN_REQUIRED",
        approvers,
      };
      res.status(200).json(response);
      return;
    }

    // ── 5. Build WebAuthn challenge ───────────────────────────────────────────
    //
    // challenge = sha256(canonicalPayload bytes) expressed as base64url.
    // This binds the WebAuthn assertion to the exact payload being signed.
    // The popup receives this and passes it to navigator.credentials.get().

    const challengeId = uuidv7();
    const challenge: WebAuthnChallenge = {
      challenge: Buffer.from(canonicalBytes).toString("base64url"),
      rpId: "proofline.web.app",
      allowCredentials: [{ type: "public-key", id: body.credentialId }],
      userVerification: "required",  // fresh path always requires UV
      timeout: 90_000,
    };

    // ── 6. Store pending challenge (90 s TTL) ─────────────────────────────────
    //
    // finalize endpoint will validate the assertion against this record and
    // refuse any assertion whose challengeId is not present or is expired.

    await storePendingChallenge(challengeId, {
      payloadHash,
      recipientSetHash: body.recipientSetHash,
      credentialId: body.credentialId,
      userId,
      companyId,
      path: "fresh",
      expiresAt: ctx.now() + 90_000,
    });

    // ── 7. Return challenge ───────────────────────────────────────────────────

    const response: SignResponse = {
      ok: true,
      challenge: { ...challenge },
      policyDecision: "APPROVED",
    };

    // Attach challengeId in a custom header so finalize can correlate.
    res.setHeader("X-ProofLine-Challenge-Id", challengeId);
    res.status(200).json(response);
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function policyErrorToHttpStatus(code: string): number {
  switch (code) {
    case "COSIGN_REQUIRED":
    case "FRESH_BIOMETRIC_REQUIRED":
    case "HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC":
      return 422;
    case "SESSION_INVALID":
    case "SESSION_EXPIRED":
    case "SESSION_REVOKED":
    case "SESSION_SCOPE_MISMATCH":
    case "USER_INACTIVE":
    case "ROLE_INVALID":
    case "DEVICE_INVALID":
      return 403;
    case "POLICY_DAILY_AGGREGATE_EXCEEDED":
    case "POLICY_AUTHORITY_EXCEEDED":
    case "POLICY_COUNTERPARTY_DEACTIVATED":
    case "ANOMALY_FLAGGED":
      return 403;
    case "PAYLOAD_HASH_MISMATCH":
    case "ASSERTION_INVALID":
    case "NONCE_REPLAYED":
      return 400;
    default:
      return 500;
  }
}