/**
 * @file sign-as-counterparty.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/sign-as-counterparty   (PFL-182)
 *
 * Counterparty signs the document → BILATERAL_SIGNED.
 *
 * Auth + identity (F-PRD-03): the signed deep-link JWS token (header) carries
 * the counterparty COMPANY in its `cp` claim; the USER is derived from the
 * verified WebAuthn assertion's registered credential. Nothing about identity
 * comes from the request body or URL, and there is no anonymous `link:<docId>`
 * fallback.
 *
 * The WebAuthn assertion is verified against the credential's registered
 * public key and the server-issued challenge (bilateral_challenges/{docId},
 * bound to the canonical payload hash by the countersign-context handler).
 * Any failure is rejected — nothing is stored unverified. The challenge is
 * single-use, and the document can only move PENDING_COUNTERPARTY → signed
 * once, so a replayed finalize is refused.
 */

import * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, type BilateralRouterDeps } from "./types.js";
import { verifyCounterpartyJwsToken } from "./jws.helpers.js";
import {
  verifyWebAuthnAssertion,
  extractCredentialId,
  extractSig,
  extractAssertionArtifacts,
  type AssertionCredential,
} from "../../webauthn/verify-assertion.js";

// Passkeys are registered with RP proofline-sign.web.app; the ceremony runs on
// the sign app and the assertion may come from the sign app or the portal
// (WebAuthn related origins).
export const BILATERAL_RP_ID = "proofline-sign.web.app";
export const BILATERAL_ORIGINS = [
  "https://proofline-sign.web.app",
  "https://proofline-counterparty.web.app",
];

const SignAsCounterpartySchema = z.object({
  docId:     z.string().min(1),
  challenge: z.string().min(1),
  assertion: z.unknown(),
});

export function makeSignAsCounterpartyHandler(deps: BilateralRouterDeps) {
  return async function signAsCounterpartyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // ── 1. Validate JWS token from header ─────────────────────────────────────
    const token = req.headers["x-proofline-bilateral-token"] as string | undefined;
    if (!token) {
      res.status(401).json(ERR.unauthorized("Missing X-ProofLine-Bilateral-Token header"));
      return;
    }

    const tokenResult = await verifyCounterpartyJwsToken(token);
    if (!tokenResult.ok) {
      res.status(401).json(ERR.unauthorized(tokenResult.detail));
      return;
    }

    // ── 2. Validate body ──────────────────────────────────────────────────────
    const parsed = SignAsCounterpartySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { docId, challenge, assertion } = parsed.data;

    if (tokenResult.docId !== docId) {
      res.status(403).json(ERR.forbidden("Token docId does not match request docId"));
      return;
    }

    const firestore = getFirestore();

    // ── 3. Load + validate the server-issued challenge ────────────────────────
    const challengeRef = firestore.collection("bilateral_challenges").doc(docId);
    const challengeSnap = await challengeRef.get();
    if (!challengeSnap.exists) {
      res.status(400).json(ERR.badRequest("No active signing challenge — reopen the document to continue."));
      return;
    }
    const stored = challengeSnap.data() as {
      challenge:   string;
      payloadHash: string;
      cp:          string;
      expiresAt:   number;
    };
    const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    if (stored.expiresAt < nowSec) {
      await challengeRef.delete();
      res.status(409).json(ERR.conflict("EXPIRED", "The signing challenge has expired — reopen the document."));
      return;
    }
    if (stored.challenge !== challenge) {
      res.status(400).json(ERR.badRequest("Challenge does not match the one issued for this document."));
      return;
    }
    // The token's company must match the challenge's company.
    if (stored.cp !== tokenResult.counterpartyId) {
      res.status(403).json(ERR.forbidden("Token counterparty does not match this challenge."));
      return;
    }

    // ── 4. Verify the WebAuthn assertion ──────────────────────────────────────
    const credentialId = extractCredentialId(assertion);
    const credSnap = credentialId
      ? await firestore.collection("webauthn_credentials").doc(credentialId).get()
      : null;
    const credential = credSnap?.exists ? (credSnap.data() as AssertionCredential) : null;

    const verification = await verifyWebAuthnAssertion({
      challenge,
      assertion,
      credentialId,
      credential,
      rpId: BILATERAL_RP_ID,
      origins: BILATERAL_ORIGINS,
    });
    if (!verification.ok || !credentialId || !credential) {
      console.warn(`[bilateral] assertion rejected for ${docId} (${verification.reason ?? "unknown"})`);
      res.status(401).json(ERR.unauthorized("The passkey assertion could not be verified."));
      return;
    }

    // ── 5. Derive + authorise identity (never from the body/URL) ──────────────
    if (credential.companyId !== tokenResult.counterpartyId) {
      res.status(403).json(ERR.forbidden("This passkey does not belong to the counterparty company."));
      return;
    }
    const userId = credential.userId;
    if (!userId) {
      res.status(403).json(ERR.forbidden("This passkey is not linked to a user account."));
      return;
    }
    const userSnap = await firestore.collection("users").doc(userId).get();
    const user = userSnap.exists ? (userSnap.data() as { companyId?: string; status?: string }) : null;
    if (!user || user.companyId !== tokenResult.counterpartyId || user.status !== "active") {
      res.status(403).json(ERR.forbidden("This account is not an active user of the counterparty company."));
      return;
    }

    // ── 6. Record the counterparty signature ──────────────────────────────────
    const artifacts = extractAssertionArtifacts(assertion);
    const result = await deps.bilateralService.signAsCounterparty(
      docId,
      { companyId: tokenResult.counterpartyId, userId },
      {
        sig: extractSig(assertion),
        credentialId,
        authenticatorData: artifacts.authenticatorData,
        clientDataJSON:    artifacts.clientDataJSON,
      },
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        DOC_NOT_FOUND:   404,
        WRONG_ACTOR:     403,
        WRONG_STATUS:    409,
        EXPIRED:         409,
        ALREADY_REVOKED: 409,
      };
      res.status(statusMap[result.code] ?? 500).json(ERR.conflict(result.code, result.detail));
      return;
    }

    // Single-use: drop the challenge so the same assertion can't be replayed.
    await challengeRef.delete();

    res.status(200).json({ docId, status: "BILATERAL_SIGNED" });
  };
}
