/**
 * @file sign-finalize.handler.ts
 * @module apps/functions/src/signing
 *
 * POST /v1/sign/finalize — Final step for BOTH fresh and silent paths.
 *
 * PFL-136: when policy still requires a cosigner (wire over the sender's
 * per-email limit), the envelope is recorded as PENDING_COSIGN with the
 * approver list, a cosign link is emailed to the approvers, and no session
 * or anchor is created yet. The approver's POST /v1/cosign/:id/finalize
 * completes it (COSIGNED + anchor).
 */

import * as express from "express";
import { v7 as uuidv7 } from "uuid";

import { validatePolicy } from "@proofline/policy";
import { renderBannerFromEnvelope } from "@proofline/email";
import {
  PolicyContext,
  SignFinalizeRequest,
  SignFinalizeRequestSchema,
  SignFinalizeResponse,
} from "@proofline/types";
import {
  buildCanonicalBytes,
  bumpDeviceLastUsedAt,
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
import {
  cosignEmailWire,
  cosignLink,
  DEFAULT_SIGN_APP_BASE_URL,
  mintCosignLinkToken,
  resolveCosignApprovers,
} from "../../cosign/cosign-request.js";

export interface SignFinalizeDeps {
  /** Sends the cosign link to the approvers (PFL-136). Omitted → not emailed. */
  sendCosignRequest?: (
    to: string[],
    wire: ReturnType<typeof cosignEmailWire>,
    link: string,
  ) => Promise<void>;
  /** Where the approval page lives (web-sign). */
  signAppBaseUrl?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeSignFinalizeHandler(ctx: PolicyContext, deps: SignFinalizeDeps = {}) {
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

    // Belt-and-suspenders: the type now requires `payload`, but a legacy
    // in-flight record (deployed before this fix) could be missing it.
    // Fail explicitly rather than crashing inside validatePolicy.
    if (!pendingChallenge.payload) {
      res.status(410).json(
        makeRFC7807Error(
          "https://proofline.app/errors/CHALLENGE_CORRUPT",
          "CHALLENGE_CORRUPT",
          410,
          "Pending challenge is missing canonical payload; request a fresh challenge"
        )
      );
      return;
    }
    const storedPayload = pendingChallenge.payload;

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
      // PFL-085: discriminate the legacy DEVICE_INVALID into the more
      // specific DEVICE_NOT_FOUND / DEVICE_REVOKED so the extension can
      // tell apart "you need to re-enroll" from "an admin killed this
      // credential". validatePolicy collapses both into one code; we
      // re-read the user to recover the distinction.
      if (code === "DEVICE_INVALID") {
        const userForDeviceCheck = await ctx.getUser(userId);
        const device = userForDeviceCheck?.devices.find(
          (d) => d.credentialId === pendingChallenge.credentialId,
        );
        const specificCode = device && device.revokedAt !== undefined && device.revokedAt !== null
          ? "DEVICE_REVOKED"
          : "DEVICE_NOT_FOUND";
        const specificDetail = specificCode === "DEVICE_REVOKED"
          ? "Credential has been revoked"
          : "Credential not enrolled for this user";
        res.status(401).json(
          makeRFC7807Error(
            `https://proofline.app/errors/${specificCode}`,
            specificCode,
            401,
            specificDetail,
          ),
        );
        return;
      }
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

    // PFL-085: split the device check so the client can tell apart "this
    // credentialId isn't registered for you" (re-enroll) from "this
    // device was revoked by an admin" (don't keep retrying). Both still
    // refuse the signature; only the failure code differs.
    const device = user.devices.find(
      (d) => d.credentialId === pendingChallenge.credentialId
    );
    if (!device) {
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/DEVICE_NOT_FOUND",
          "DEVICE_NOT_FOUND",
          401,
          "Credential not enrolled for this user",
        )
      );
      return;
    }
    if (device.revokedAt !== undefined && device.revokedAt !== null) {
      res.status(401).json(
        makeRFC7807Error(
          "https://proofline.app/errors/DEVICE_REVOKED",
          "DEVICE_REVOKED",
          401,
          "Credential has been revoked",
        )
      );
      return;
    }

    const assertionValid = await verifyWebAuthnAssertion({
      assertion: body.assertion,
      expectedChallenge: buildCanonicalBytes(storedPayload),
      expectedOrigin: "https://proofline-sign.web.app",
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

    // PFL-094-followup: only attach sessionId when a real session backs this
    // signature. The fresh path has no session at this point (one is created
    // below), so the prior `sessionId: parsedSessionToken?.sessionId` wrote
    // `undefined`, which Firestore's WriteBatch.set rejects with
    // "Cannot use \"undefined\" as a Firestore value (found in field
    // signatures.`0`.sessionId)". The correct on-disk representation is to
    // omit the key entirely — sessionId is `?:` in EmailSignedEnvelope.
    const signatureRecord: EmailSignedEnvelope["signatures"][number] = {
      signerId:     userId,
      credentialId: pendingChallenge.credentialId,
      sig:          body.assertion.signature,
      signedAt:     now,
      path:         body.path,
      // PFL-125: store the WebAuthn artifacts so verify-time can
      // reconstruct (authData || sha256(clientDataJSON)) and validate
      // the signature against THIS payload (challenge binding).
      authenticatorData: body.assertion.authenticatorData,
      clientDataJSON:    body.assertion.clientDataJSON,
    };
    if (parsedSessionToken?.sessionId) {
      signatureRecord.sessionId = parsedSessionToken.sessionId;
    }

    // PFL-136: policy (re-run above) decides whether a cosigner is still needed.
    const cosignPending = policyResult.value.decision === "COSIGN_REQUIRED";
    const nowSec = Math.floor(now / 1000);
    const approvers = cosignPending ? await resolveCosignApprovers(companyId, userId) : [];
    if (cosignPending && approvers.length === 0) {
      res.status(422).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NO_ELIGIBLE_COSIGNER",
          "NO_ELIGIBLE_COSIGNER",
          422,
          "This wire needs a cosigner, but no other active owner or manager can approve it.",
        ),
      );
      return;
    }
    const cosignTtlSec = cosignPending
      ? Math.max(60, Math.floor((await ctx.getCompanyPolicy(companyId)).cosignTtlMs / 1000))
      : 0;

    const envelope: EmailSignedEnvelope = {
      envelopeId,
      payload:     storedPayload,
      payloadHash: body.payloadHash,
      signatures:  [signatureRecord],
      status:      cosignPending ? "PENDING_COSIGN" : "SIGNED",
      createdAt:   now,
      ...(pendingChallenge.screening ? { screening: pendingChallenge.screening } : {}),
      ...(cosignPending
        ? {
            cosign: {
              approverUserIds: approvers.map((a) => a.userId),
              approverEmails:  approvers.map((a) => a.email),
              requestedAt:     nowSec,
              linkExpiresAt:   nowSec + cosignTtlSec,
            },
          }
        : {}),
    };

    await recordSignedEnvelope(envelope);

    // PFL-085: bump devices[].lastUsedAt on the credential that just
    // signed. Best-effort — failure here doesn't roll back the signature.
    await bumpDeviceLastUsedAt(userId, pendingChallenge.credentialId, now);

    // ── 7b. Cosign request (PFL-136) ──────────────────────────────────────────
    // The link goes only to the approvers, never the wire's recipients, and is
    // never logged. No session or anchor until the approver signs.

    if (cosignPending) {
      const { token } = mintCosignLinkToken({
        companyId, messageId: envelopeId, payloadHash: body.payloadHash, ttlSec: cosignTtlSec, nowSec,
      });
      let emailed = false;
      if (deps.sendCosignRequest) {
        try {
          await deps.sendCosignRequest(
            approvers.map((a) => a.email),
            cosignEmailWire(storedPayload),
            cosignLink(deps.signAppBaseUrl ?? DEFAULT_SIGN_APP_BASE_URL, envelopeId, token),
          );
          emailed = true;
        } catch (err) {
          console.error(`[sign-finalize] cosign email failed for ${envelopeId}`, err instanceof Error ? err.message : err);
        }
      } else {
        console.warn(`[sign-finalize] no cosign email sender configured; request for ${envelopeId} not emailed`);
      }

      res.status(200).json({
        ok:       true,
        envelope,
        banner:   "",
        cosign: {
          status:        "PENDING_COSIGN",
          envelopeId,
          approverCount: approvers.length,
          emailed,
          linkExpiresAt: nowSec + cosignTtlSec,
        },
      });
      return;
    }

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