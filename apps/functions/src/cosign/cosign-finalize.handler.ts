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
 *   1. Verify the JWS signature + expiry (PFL-171).
 *   2. Confirm the `sub` claim matches the URL `messageId`.
 *   3. Look up the persisted cosign_challenges/{messageId} record and
 *      check `challenge` body field == stored challenge && not expired.
 *   4. Verify the WebAuthn assertion against the cosigner's registered
 *      public key (webauthn_credentials/{credentialId}). Any failure is
 *      401 ASSERTION_INVALID — nothing is accepted unverified (PFL-171).
 *   5. Check the cosigner may approve this wire: same company as the
 *      link issuer, active owner/manager, not an original signer, device
 *      not revoked, and on the stored approver list when there is one.
 *      Otherwise 403 COSIGNER_NOT_ALLOWED.
 *   6. Append the cosigner entry to signed_messages/{messageId}.
 *   7. Queue an anchor batch row and return { ok, anchorWillFollow }.
 *
 * Passkeys are registered with rpId proofline-sign.web.app, so the
 * assertion must name that RP. It may come from the sign app or from the
 * counterparty portal (WebAuthn related origins).
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

// ─── WebAuthn verification (required) ────────────────────────────────────────

export const COSIGN_RP_ID = "proofline-sign.web.app";
export const COSIGN_ORIGINS = [
  "https://proofline-sign.web.app",
  "https://proofline-counterparty.web.app",
];

interface CredentialRecord {
  userId?:    string;
  companyId?: string;
  publicKey?: string;
}

async function verifyAssertion(
  challenge: string,
  assertion: unknown,
  credentialId: string | null,
  credential: CredentialRecord | null,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!credentialId) {
      return { ok: false, reason: "NO_CREDENTIAL_ID" };
    }
    if (!credential) {
      return { ok: false, reason: "CREDENTIAL_NOT_FOUND" };
    }
    const publicKey = credential.publicKey;
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
      rpId: COSIGN_RP_ID,
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });

    const result = await finishAssertion({
      response,
      expectedRPID: COSIGN_RP_ID,
      expectedOrigin: COSIGN_ORIGINS,
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

// ─── Cosigner eligibility ────────────────────────────────────────────────────

const COSIGNER_ROLES = new Set(["owner", "manager"]);

export function cosignerProblem(input: {
  issuerCompanyId: string;
  credential:      CredentialRecord;
  user:            { companyId?: string; status?: string; role?: string; email?: string;
                     devices?: { credentialId?: string; revokedAt?: unknown }[] } | null;
  originalSignerIds: string[];
  approverEmails:  string[];
  credentialId:    string;
}): string | null {
  const { credential, user } = input;
  if (credential.companyId !== input.issuerCompanyId) return "credential belongs to another company";
  if (!credential.userId || !user) return "cosigner account not found";
  if (user.companyId !== input.issuerCompanyId) return "cosigner is not in the issuing company";
  if (user.status !== "active") return "cosigner account is not active";
  if (!user.role || !COSIGNER_ROLES.has(user.role)) return "cosigner role cannot approve wires";
  if (input.originalSignerIds.includes(credential.userId)) return "the original signer cannot cosign";
  const device = (user.devices ?? []).find((d) => d?.credentialId === input.credentialId);
  if (device && device.revokedAt) return "this device has been revoked";
  if (input.approverEmails.length > 0) {
    const email = (user.email ?? "").toLowerCase();
    if (!input.approverEmails.map((e) => e.toLowerCase()).includes(email)) return "cosigner is not on the approver list";
  }
  return null;
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

    const credentialId =
      typeof assertion === "object" && assertion !== null
        ? ((assertion as Record<string, unknown>)["credentialId"] as string | undefined)
          ?? ((assertion as Record<string, unknown>)["id"] as string | undefined)
          ?? null
        : null;
    const credSnap = credentialId
      ? await firestore.collection("webauthn_credentials").doc(credentialId).get()
      : null;
    const credential = credSnap?.exists ? (credSnap.data() as CredentialRecord) : null;

    const verification = await verifyAssertion(clientChallenge, assertion, credentialId, credential);
    if (!verification.ok || !credentialId || !credential) {
      console.warn(`[cosign-finalize] assertion rejected for ${messageId} (${verification.reason ?? "unknown"})`);
      respond(res, 401, {
        ok:     false,
        code:   "ASSERTION_INVALID",
        detail: "The passkey assertion could not be verified.",
      });
      return;
    }

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
    const message = messageSnap.data() as {
      payloadHash?: string;
      signers?:     { userId?: string; signerId?: string }[];
      signatures?:  { userId?: string; signerId?: string }[];
      cosign?:      { approverEmails?: unknown };
    };
    if (message.payloadHash !== decoded.claims.payloadHash || stored.payloadHash !== decoded.claims.payloadHash) {
      respond(res, 400, {
        ok:     false,
        code:   "COSIGN_LINK_INVALID",
        detail: "Cosign token does not match this message",
      });
      return;
    }
    const existing = message.signers ?? message.signatures ?? [];
    if (existing.length > 1) {
      respond(res, 409, {
        ok:     false,
        code:   "ALREADY_COSIGNED",
        detail: "This wire has already been cosigned.",
      });
      return;
    }

    const userSnap = credential.userId
      ? await firestore.collection("users").doc(credential.userId).get()
      : null;
    const problem = cosignerProblem({
      issuerCompanyId:   decoded.claims.iss,
      credential,
      user:              userSnap?.exists ? (userSnap.data() as Parameters<typeof cosignerProblem>[0]["user"]) : null,
      originalSignerIds: existing.map((s) => s.userId ?? s.signerId ?? "").filter(Boolean),
      approverEmails:    Array.isArray(message.cosign?.approverEmails)
        ? (message.cosign!.approverEmails as unknown[]).filter((e): e is string => typeof e === "string")
        : [],
      credentialId,
    });
    if (problem) {
      console.warn(`[cosign-finalize] cosigner rejected for ${messageId}: ${problem}`);
      respond(res, 403, {
        ok:     false,
        code:   "COSIGNER_NOT_ALLOWED",
        detail: `This account can't cosign this wire: ${problem}.`,
      });
      return;
    }

    const resp = (assertion as { response?: Record<string, unknown> }).response ?? {};
    const cosignerEntry = {
      userId:            credential.userId!,
      credentialId,
      role:              "cosigner",
      sig:               extractSig(assertion),
      signedAt:          nowSec,
      sessionId:         null,
      authenticatorData: String(resp["authenticatorData"] ?? ""),
      clientDataJSON:    String(resp["clientDataJSON"] ?? ""),
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
