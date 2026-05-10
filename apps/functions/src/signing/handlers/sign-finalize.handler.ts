/**
 * @file sign-finalize.handler.ts
 * @module apps/functions/src/signing
 *
 * POST /v1/sign/finalize — Final step for BOTH fresh and silent paths.
 */

import * as express from "express";
import { v7 as uuidv7 } from "uuid";

import { validatePolicy } from "@proofline/policy";
import { renderBannerFromEnvelope } from "@proofline/email";
import {
  EmailPayload,
  PolicyContext,
  SignFinalizeRequest,
  SignFinalizeRequestSchema,
  SignFinalizeResponse,
} from "@proofline/types";
import {
  buildCanonicalBytes,
  consumePendingChallenge,
  createSession,
  EmailSignedEnvelope,
  extendSession,
  issueSessionToken,
  queueAnchorBatch,
  recordSignedEnvelope,
  resolveSignerDisplayRecord,
  verifyWebAuthnAssertion,
  verifySessionTokenJWS,
  hashPayload,
} from "./signing.helpers.js";
import { makeRFC7807Error } from "./http.helpers.js";

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeSignFinalizeHandler(ctx: PolicyContext) {
  return async function signFinalizeHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {

    // ── 1. Parse body ─────────────────────────────────────────────────────────

    const parseResult = SignFinalizeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(
        makeRFC7807Error("about:blank", "Bad Request", 400, parseResult.error.message)
      );
      return;
    }

    const body: SignFinalizeRequest = parseResult.data;
    const { userId, companyId } = (req as any).user as {
      userId: string;
      companyId: string;
    };

    const challengeId = req.headers["x-proofline-challenge-id"] as string | undefined;
    if (!challengeId) {
      res.status(400).json(
        makeRFC7807Error("about:blank", "Bad Request", 400, "Missing X-ProofLine-Challenge-Id header")
      );
      return;
    }

    // ── 2. Consume pending challenge ──────────────────────────────────────────

    const pendingChallenge = await consumePendingChallenge(challengeId);
    if (!pendingChallenge) {
      res.status(400).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NONCE_REPLAYED",
          "NONCE_REPLAYED",
          400,
          "Challenge not found, expired, or already consumed"
        )
      );
      return;
    }

    if (pendingChallenge.path !== body.path) {
      res.status(400).json(
        makeRFC7807Error("about:blank", "Bad Request", 400, "path mismatch with issued challenge")
      );
      return;
    }

    // ── 3. Payload hash must match ────────────────────────────────────────────

    if (pendingChallenge.payloadHash !== body.payloadHash) {
      res.status(400).json(
        makeRFC7807Error(
          "https://proofline.app/errors/PAYLOAD_HASH_MISMATCH",
          "PAYLOAD_HASH_MISMATCH",
          400,
          "Payload hash does not match issued challenge"
        )
      );
      return;
    }

    // ── 4. Parse session token on silent path ─────────────────────────────────

    let parsedSessionToken = undefined;
    if (body.path === "silent") {
      if (!body.sessionToken) {
        res.status(400).json(
          makeRFC7807Error("about:blank", "Bad Request", 400, "sessionToken required on silent path")
        );
        return;
      }
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
    }

    // ── 5. Re-run FULL policy pipeline — second pass (F-SIG-11) ──────────────

    const storedPayload = pendingChallenge.payload as EmailPayload;

    const policyResult = await validatePolicy(
      {
        payload: storedPayload,
        payloadHash: body.payloadHash,
        recipientSetHash: body.recipientSetHash,
        userId,
        companyId,
        credentialId: pendingChallenge.credentialId,
        sessionToken: body.sessionToken,
        parsedSessionToken,
        freshBiometric: body.path === "fresh",
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

    // ── 6. Verify WebAuthn assertion ──────────────────────────────────────────

    const user = await ctx.getUser(userId);
    if (!user) {
      res.status(403).json(
        makeRFC7807Error("https://proofline.app/errors/USER_INACTIVE", "USER_INACTIVE", 403)
      );
      return;
    }

    const device = user.devices.find(
      (d) => d.credentialId === pendingChallenge.credentialId
    );
    if (!device) {
      res.status(403).json(
        makeRFC7807Error("https://proofline.app/errors/DEVICE_INVALID", "DEVICE_INVALID", 403)
      );
      return;
    }

    const assertionValid = await verifyWebAuthnAssertion({
      assertion: body.assertion,
      expectedChallenge: buildCanonicalBytes(storedPayload),
      expectedOrigin: "https://proofline.app",
      publicKey: device.publicKey,
    });

    if (!assertionValid) {
      res.status(400).json(
        makeRFC7807Error(
          "https://proofline.app/errors/ASSERTION_INVALID",
          "ASSERTION_INVALID",
          400,
          "WebAuthn assertion failed cryptographic verification"
        )
      );
      return;
    }

    // ── 7. Record signed envelope ─────────────────────────────────────────────

    const envelopeId = uuidv7();
    const now = ctx.now();

    const envelope: EmailSignedEnvelope = {
      envelopeId,
      payload: storedPayload,
      payloadHash: body.payloadHash,
      signatures: [
        {
          signerId: userId,
          credentialId: pendingChallenge.credentialId,
          sig: body.assertion.signature,
          signedAt: now,
          sessionId: parsedSessionToken?.sessionId,
          path: body.path,
        },
      ],
      status: "SIGNED",
      createdAt: now,
    };

    await recordSignedEnvelope(envelope);

    // ── 8. Session management ─────────────────────────────────────────────────

    let sessionToken: string | undefined;

    if (body.path === "silent" && parsedSessionToken) {
      await extendSession(parsedSessionToken.sessionId, ctx);
    } else if (body.path === "fresh") {
      const session = await createSession({
        userId,
        companyId,
        recipientSetHash: body.recipientSetHash,
        recipientAddresses: storedPayload.to,
        deviceCredentialId: pendingChallenge.credentialId,
        now,
        policy: await ctx.getCompanyPolicy(companyId),
      });
      sessionToken = await issueSessionToken(session);
    }

    // ── 9. Queue Merkle anchor batch ──────────────────────────────────────────

    await queueAnchorBatch(envelopeId, body.payloadHash);

    // ── 10. Render inline HTML banner (F-VER-08) ──────────────────────────────

    const signerDisplay = await Promise.all(
      envelope.signatures.map((sig) => resolveSignerDisplayRecord(sig.signerId))
    );

    const banner = renderBannerFromEnvelope(envelope, signerDisplay);

    // ── 11. Return response ───────────────────────────────────────────────────

    const response: SignFinalizeResponse = {
      ok: true,
      envelope: envelope as any,  // local type satisfies response contract
      banner,
      ...(sessionToken ? { sessionToken } : {}),
    };

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
    case "COSIGN_REQUIRED":
      return 422;
    case "USER_INACTIVE":
    case "ROLE_INVALID":
    case "DEVICE_INVALID":
    case "POLICY_COUNTERPARTY_DEACTIVATED":
    case "ANOMALY_FLAGGED":
    case "POLICY_DAILY_AGGREGATE_EXCEEDED":
      return 403;
    case "PAYLOAD_HASH_MISMATCH":
    case "ASSERTION_INVALID":
    case "NONCE_REPLAYED":
      return 400;
    default:
      return 500;
  }
}