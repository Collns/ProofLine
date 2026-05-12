/**
 * @file cosign-finalize.handler.ts
 * @module apps/functions/src/cosign
 *
 * POST /v1/cosign/:messageId/finalize  (PFL-062)
 *
 * Body: { assertion, challenge }
 * Header: X-ProofLine-Cosign-Token: <jws>
 *
 * Steps:
 *   1. Decode JWS structurally (signature check deferred — see helpers).
 *   2. Confirm the `sub` claim matches the URL `messageId`.
 *   3. Look up the persisted cosign_challenges/{messageId} record and
 *      check `challenge` body field == stored challenge && not expired.
 *   4. Verify the WebAuthn assertion against the stored challenge bytes.
 *      For the hackathon slice we DO NOT have the cosigner's public key
 *      indexed yet, so verification is best-effort and a soft failure
 *      logs a warning rather than rejecting (per PFL-062 simplification).
 *   5. Append a cosigner entry to signed_messages/{messageId}.signers.
 *   6. Queue an anchor batch row.
 *   7. Return { ok: true, anchorWillFollow: true }.
 */

import type * as express from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { decodeCosignJws } from "./cosign.helpers.js";
import type { FinalizeCosignResponse } from "./cosign.types.js";
import { finishAssertion, InMemoryChallengeStore } from "@proofline/webauthn";

// ─── Request body schema ─────────────────────────────────────────────────────
//
// The popup posts {assertion, challenge}; assertion's internal shape is
// validated lazily inside @proofline/webauthn so we accept `unknown` here
// and let downstream code decide whether the assertion is structurally
// usable.
const CosignFinalizeBodySchema = z.object({
  assertion: z.unknown(),
  challenge: z.string().min(1, "challenge is required"),
});

// ─── Optional WebAuthn verification ──────────────────────────────────────────
//
// We try to verify, but if the cosigner's public key isn't on file yet we
// log + continue. The cosign credential index is a follow-up ticket.
async function tryVerifyAssertion(
  challenge: string,
  assertion: unknown,
  credentialId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!credentialId) {
      return { ok: false, reason: "NO_CREDENTIAL_INDEXED" };
    }
    const firestore = getFirestore();
    const credSnap = await firestore.collection("webauthn_credentials").doc(credentialId).get();
    if (!credSnap.exists) {
      return { ok: false, reason: "CREDENTIAL_NOT_FOUND" };
    }
    const publicKey = (credSnap.data() as Record<string, unknown>)["publicKey"];
    if (typeof publicKey !== "string") {
      return { ok: false, reason: "PUBKEY_MISSING" };
    }

    // The popup posts the assertion as a structural subset of
    // AuthenticationResponseJSON; finishAssertion reads clientDataJSON to pull
    // the challenge, then looks it up in the ChallengeStore we seed below.
    const response = adaptAssertionForFinish(assertion);
    if (!response) {
      return { ok: false, reason: "ASSERTION_SHAPE_INVALID" };
    }

    const challengeStore = new InMemoryChallengeStore();
    const now = Date.now();
    await challengeStore.put({
      challenge,
      userId: "",
      purpose: "assertion",
      rpId: "proofline-counterparty.web.app",
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });

    const result = await finishAssertion({
      response,
      expectedRPID: "proofline-counterparty.web.app",
      expectedOrigin: "https://proofline-counterparty.web.app",
      storedPublicKey: publicKey,
      storedSignCount: 0,
      challengeStore,
    });
    return { ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "VERIFY_THREW" };
  }
}

function adaptAssertionForFinish(
  assertion: unknown,
): Parameters<typeof finishAssertion>[0]["response"] | null {
  if (!assertion || typeof assertion !== "object") return null;
  const a = assertion as Record<string, unknown>;
  const id = (a["id"] ?? a["credentialId"]) as string | undefined;
  const inner = a["response"];
  if (!id || !inner || typeof inner !== "object") return null;
  const r = inner as Record<string, unknown>;
  if (
    typeof r["clientDataJSON"] !== "string" ||
    typeof r["authenticatorData"] !== "string" ||
    typeof r["signature"] !== "string"
  ) {
    return null;
  }
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: r["clientDataJSON"] as string,
      authenticatorData: r["authenticatorData"] as string,
      signature: r["signature"] as string,
      ...(typeof r["userHandle"] === "string" ? { userHandle: r["userHandle"] as string } : {}),
    },
  } as Parameters<typeof finishAssertion>[0]["response"];
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export function makeCosignFinalizeHandler() {
  return async function cosignFinalizeHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const messageId = req.params["messageId"];
    if (typeof messageId !== "string" || messageId.length === 0) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "messageId is required",
      });
      return;
    }

    const token = typeof req.headers["x-proofline-cosign-token"] === "string"
      ? (req.headers["x-proofline-cosign-token"] as string)
      : "";
    if (!token) {
      respond(res, 401, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "Missing X-ProofLine-Cosign-Token header",
      });
      return;
    }

    const decoded = decodeCosignJws(token);
    if (!decoded.ok) {
      const code = decoded.reason === "EXPIRED" ? "COSIGN_LINK_EXPIRED" : "COSIGN_LINK_INVALID";
      respond(res, 401, {
        ok:     false,
        code,
        detail: `Cosign token rejected (${decoded.reason})`,
      });
      return;
    }
    if (decoded.claims.sub !== messageId) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "Token subject does not match messageId",
      });
      return;
    }

    const parsedBody = CosignFinalizeBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      respond(res, 400, {
        ok:     false,
        code:   "ASSERTION_INVALID",
        detail: parsedBody.error.message,
      });
      return;
    }
    const { assertion, challenge: clientChallenge } = parsedBody.data;

    const firestore = getFirestore();

    // Consume the persisted challenge — single use.
    const challengeRef = firestore.collection("cosign_challenges").doc(messageId);
    const challengeSnap = await challengeRef.get();
    if (!challengeSnap.exists) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "No active cosign challenge — request a fresh link",
      });
      return;
    }
    const stored = challengeSnap.data() as {
      challenge:   string;
      expiresAt:   number;
      payloadHash: string;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    if (stored.expiresAt < nowSec) {
      await challengeRef.delete();
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_EXPIRED",
        detail: "Cosign challenge expired",
      });
      return;
    }
    if (stored.challenge !== clientChallenge) {
      respond(res, 400, {
        ok:     false,
        code:   "ASSERTION_INVALID",
        detail: "Challenge in request body does not match issued challenge",
      });
      return;
    }

    // Best-effort assertion verification. credentialId is sniffed from the
    // assertion when shaped like AuthenticationResponseJSON; an unverifiable
    // assertion logs a warning but does not block (hackathon scope).
    const credentialId =
      typeof assertion === "object" && assertion !== null
        ? ((assertion as Record<string, unknown>)["credentialId"] as string | undefined)
          ?? ((assertion as Record<string, unknown>)["id"] as string | undefined)
          ?? null
        : null;
    const verification = await tryVerifyAssertion(clientChallenge, assertion, credentialId);
    if (!verification.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[cosign-finalize] assertion not verified for ${messageId} (${verification.reason}) — accepting under hackathon policy. ` +
          "TODO(PFL-COSIGN-VERIFY): require successful verification before finalizing.",
      );
    }

    // Append the cosigner to the envelope. Use FieldValue.arrayUnion so
    // concurrent finalize calls don't clobber each other.
    const messageRef = firestore.collection("signed_messages").doc(messageId);
    const messageSnap = await messageRef.get();
    if (!messageSnap.exists) {
      respond(res, 404, {
        ok:     false,
        code:   "NOT_FOUND",
        detail: "Signed message not found",
      });
      return;
    }

    const cosignerEntry = {
      userId:       credentialId ? `cosigner:${credentialId.slice(0, 12)}` : "cosigner:unknown",
      credentialId: credentialId ?? "unknown",
      role:         "cosigner",
      sig:          extractSig(assertion),
      signedAt:     nowSec,
      sessionId:    null,
    };

    await messageRef.set(
      {
        signers:    FieldValue.arrayUnion(cosignerEntry),
        signatures: FieldValue.arrayUnion(cosignerEntry),
        status:     "COSIGNED",
      },
      { merge: true },
    );

    // Single-use challenge — drop it now.
    await challengeRef.delete();

    // Queue for the anchor batcher (PFL-027 path).
    await firestore.collection("anchor_queue").add({
      envelopeId:  messageId,
      payloadHash: stored.payloadHash,
      queuedAt:    Date.now(),
      source:      "cosign-finalize",
    });

    const response: FinalizeCosignResponse = {
      ok:               true,
      messageId,
      anchorWillFollow: true,
    };
    respond(res, 200, response);
  };
}

function extractSig(assertion: unknown): string {
  if (!assertion || typeof assertion !== "object") return "";
  const a = assertion as Record<string, unknown>;
  const direct = a["signature"];
  if (typeof direct === "string") return direct;
  const resp = a["response"];
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (typeof r["signature"] === "string") return r["signature"] as string;
  }
  return "";
}

function respond(
  res: express.Response,
  status: number,
  body: FinalizeCosignResponse,
): void {
  res.status(status).json(body);
}
