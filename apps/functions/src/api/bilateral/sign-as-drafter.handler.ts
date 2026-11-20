/**
 * @file sign-as-drafter.handler.ts
 * @module apps/functions/src/api/bilateral
 *
 * POST /v1/bilateral/sign-as-drafter   (PFL-146)
 *
 * The drafter signs a DRAFT document → PENDING_COUNTERPARTY, which emails the
 * counterparty a deep link.
 *
 * Auth: a Firebase ID token (requireCompanyUser sets req.user). The drafter
 * additionally proves possession of their passkey: the WebAuthn assertion is
 * verified against the drafter's registered credential and a challenge bound
 * to the canonical payload (RP proofline-sign.web.app). The credential must
 * belong to the authenticated drafter (same userId + companyId); nothing is
 * stored unverified, so the drafter signature verifies for real on the verify
 * page (no legacy soft-skip). The document can only leave DRAFT once, so the
 * assertion cannot be replayed.
 */

import * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { canonicalize } from "@proofline/canonical";

import { ERR, type BilateralRouterDeps } from "./types.js";
import { buildCounterpartyJwsLink } from "./jws.helpers.js";
import { BILATERAL_RP_ID, BILATERAL_ORIGINS } from "./sign-as-counterparty.handler.js";
import {
  verifyWebAuthnAssertion,
  extractCredentialId,
  extractSig,
  extractAssertionArtifacts,
  type AssertionCredential,
} from "../../webauthn/verify-assertion.js";

const SignAsDrafterSchema = z.object({
  docId:             z.string().min(1),
  assertion:         z.unknown(),
  counterpartyEmail: z.string().email(),
  drafterName:       z.string().min(1),
});

export function makeSignAsDrafterHandler(deps: BilateralRouterDeps) {
  return async function signAsDrafterHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const { userId, companyId } = (req as express.Request & { user?: { userId?: string; companyId?: string } }).user ?? {};
    if (!userId || !companyId) {
      res.status(401).json(ERR.unauthorized("Sign in with a company account"));
      return;
    }

    const parsed = SignAsDrafterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { docId, assertion, counterpartyEmail, drafterName } = parsed.data;

    // Load the document to bind the assertion to its canonical payload.
    const docResult = await deps.bilateralService.getDocument(docId);
    if (!docResult.ok) {
      res.status(404).json(ERR.notFound(docResult.detail));
      return;
    }
    const docPayload = docResult.value.payload;
    if (docPayload.drafterCompanyId !== companyId) {
      res.status(403).json(ERR.forbidden("Only the drafter company can sign as drafter"));
      return;
    }

    // Verify the drafter's passkey assertion against the canonical payload.
    const challenge = Buffer.from(canonicalize(docPayload)).toString("base64url");
    const firestore = getFirestore();
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
      console.warn(`[bilateral] drafter assertion rejected for ${docId} (${verification.reason ?? "unknown"})`);
      res.status(401).json(ERR.unauthorized("The passkey assertion could not be verified."));
      return;
    }
    // The passkey must belong to the authenticated drafter.
    if (credential.companyId !== companyId || credential.userId !== userId) {
      res.status(403).json(ERR.forbidden("This passkey does not belong to the signed-in drafter."));
      return;
    }

    const artifacts = extractAssertionArtifacts(assertion);
    const result = await deps.bilateralService.signAsDrafter(
      docId,
      { userId, companyId },
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

    const doc = result.value;

    const signLink = await buildCounterpartyJwsLink({
      baseUrl:               deps.counterpartyPortalBaseUrl,
      docId,
      drafterCompanyId:      companyId,
      counterpartyCompanyId: doc.payload.counterpartyCompanyId,
      expiresAt:             doc.payload.expiresAt,
    });

    await deps.email.sendBilateralRequest(
      counterpartyEmail,
      {
        documentId:     docId,
        documentType:   doc.payload.docType,
        drafterName,
        drafterCompany: companyId,
      },
      signLink,
    );

    res.status(200).json({ docId, status: "PENDING_COUNTERPARTY", signLink });
  };
}
