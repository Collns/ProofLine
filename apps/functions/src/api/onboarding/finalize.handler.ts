/**
 * @file finalize.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * POST /v1/onboard/finalize
 *
 * The final step of the onboarding pipeline (TDD §5.1).
 *
 * Flow (mirrors the sequence diagram):
 *   1. Validate body (companyId).
 *   2. Load company — must be pending_kyc or pending_finalize.
 *   3. Guard: officer KYC must be verified (officerEnrollment.verifiedAt set).
 *   4. Create a Cloud KMS EC P-256 root key for the company.
 *   5. Export the public key (SPKI base64) and store it.
 *   6. Build the first role credential for the owner (signed by KMS).
 *   7. Store the RoleCredential in Firestore (role_credentials/{credentialId}).
 *   8. Compute a Merkle root over the initial registry state.
 *   9. Post the root to Base Sepolia via the anchoring provider.
 *  10. Advance company status to "verified".
 *  11. Return summary.
 *
 * Auth: Firebase ID token — ownerUserId check.
 */

import * as express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";

import { ERR } from "./http.helpers.js";
import { getCompany, updateCompany } from "./onboarding.helpers.js";

// ─── Provider interfaces (mirrors packages/*) ────────────────────────────────

export interface KmsProvider {
  createCompanyRootKey(companyId: string): Promise<{ keyName: string }>;
  signWithKms(keyName: string, messageBytes: Uint8Array): Promise<string>;  // base64url signature
  exportPublicKey(keyName: string): Promise<string>;                         // SPKI base64
}

export interface AnchorProvider {
  buildTree(events: RegistryEvent[]): { root: string };
  postAnchor(root: string): Promise<{ txHash: string; blockNumber: number }>;
}

export interface RegistryEvent {
  type:      string;
  companyId: string;
  payload:   unknown;
  timestamp: number;
}

// ─── Role credential (minimal, matches @proofline/types RoleCredential) ───────

interface RoleCredential {
  credentialId:  string;
  companyId:     string;
  userId:        string;
  role:          "owner" | "manager" | "employee";
  domain:        string;
  publicKey:     string;   // SPKI base64 — placeholder; WebAuthn key enrolled later
  issuedAt:      number;
  expiresAt:     number | null;
  issuerKeyName: string;   // KMS key resource name used to sign
  sig:           string;   // KMS signature over canonical bytes (base64url)
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const FinalizeRequestSchema = z.object({
  companyId: z.string().min(1),
});

// ─── Canonical bytes for role credential ─────────────────────────────────────

function canonicalCredentialBytes(cred: Omit<RoleCredential, "sig">): Uint8Array {
  const json = JSON.stringify({
    v:            1,
    credentialId: cred.credentialId,
    companyId:    cred.companyId,
    userId:       cred.userId,
    role:         cred.role,
    domain:       cred.domain,
    issuedAt:     cred.issuedAt,
  });
  return new TextEncoder().encode(json);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeFinalizeHandler(deps: {
  kmsProvider:    KmsProvider;
  anchorProvider: AnchorProvider;
}) {
  return async function finalizeHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Parse ──────────────────────────────────────────────────────────────

    const parseResult = FinalizeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const { companyId } = parseResult.data;
    const { userId }    = (req as any).user as { userId: string };

    // ── 2. Load company ───────────────────────────────────────────────────────

    const company = await getCompany(companyId);
    if (!company) {
      res.status(404).json(ERR.notFound(`Company ${companyId} not found`));
      return;
    }
    if (company.ownerUserId !== userId) {
      res.status(403).json(ERR.forbidden());
      return;
    }

    const allowedStatuses = ["pending_kyc", "pending_finalize"];
    if (!allowedStatuses.includes(company.onboardingStatus)) {
      res.status(409).json(
        ERR.conflict(
          "ONBOARDING_STEP_INVALID",
          `Finalize not allowed in status: ${company.onboardingStatus}`
        )
      );
      return;
    }

    // ── 3. Guard: KYC must be complete ────────────────────────────────────────

    if (!company.officerEnrollment?.verifiedAt) {
      res.status(422).json(
        ERR.unprocessable(
          "KYC_INCOMPLETE",
          "Officer identity verification has not been confirmed yet. " +
          "Please complete the Stripe Identity flow or wait for the webhook."
        )
      );
      return;
    }

    // ── 4. Create KMS root key ────────────────────────────────────────────────

    let keyName: string;
    let rootPublicKey: string;

    try {
      const kmsResult = await deps.kmsProvider.createCompanyRootKey(companyId);
      keyName        = kmsResult.keyName;
      rootPublicKey  = await deps.kmsProvider.exportPublicKey(keyName);
    } catch (err) {
      console.error("[finalize] KMS createCompanyRootKey failed", err);
      res.status(502).json(ERR.internal("Key creation failed. Please retry."));
      return;
    }

    // ── 5. Persist key details immediately (so we can recover if later steps fail) ─

    await updateCompany(companyId, {
      kmsKeyName:      keyName,
      rootPublicKey,
      onboardingStatus: "pending_finalize",
    });

    // ── 6. Sign first role credential ─────────────────────────────────────────

    const now          = Date.now();
    const credentialId = randomUUID();

    const credWithoutSig: Omit<RoleCredential, "sig"> = {
      credentialId,
      companyId,
      userId,
      role:         "owner",
      domain:       company.domain,
      publicKey:    "",   // owner's WebAuthn pubkey enrolled separately via /v1/webauthn/enroll
      issuedAt:     now,
      expiresAt:    null,
      issuerKeyName: keyName,
    };

    let sig: string;
    try {
      sig = await deps.kmsProvider.signWithKms(
        keyName,
        canonicalCredentialBytes(credWithoutSig)
      );
    } catch (err) {
      console.error("[finalize] KMS sign failed", err);
      res.status(502).json(ERR.internal("Key signing failed. Please retry."));
      return;
    }

    const credential: RoleCredential = { ...credWithoutSig, sig };

    // ── 7. Persist role credential ────────────────────────────────────────────

    const firestore = getFirestore();
    await firestore.collection("role_credentials").doc(credentialId).set(credential);

    // ── 8. Compute Merkle root over initial registry state ────────────────────

    const registryEvents: RegistryEvent[] = [
      {
        type:      "COMPANY_VERIFIED",
        companyId,
        payload:   { domain: company.domain, legalName: company.legalName },
        timestamp: now,
      },
      {
        type:      "CREDENTIAL_ISSUED",
        companyId,
        payload:   { credentialId, role: "owner", userId },
        timestamp: now,
      },
    ];

    const { root } = deps.anchorProvider.buildTree(registryEvents);

    // ── 9. Post anchor to Base Sepolia ────────────────────────────────────────

    let anchorTxHash: string;
    let anchorBlockNumber: number;

    try {
      const anchorResult = await deps.anchorProvider.postAnchor(root);
      anchorTxHash     = anchorResult.txHash;
      anchorBlockNumber = anchorResult.blockNumber;
    } catch (err) {
      console.error("[finalize] Anchor postAnchor failed", err);
      // Non-fatal for hackathon — we still complete onboarding.
      // Log and continue; anchor can be retried by the batch job.
      anchorTxHash     = "";
      anchorBlockNumber = 0;
      console.warn("[finalize] Proceeding without confirmed anchor. Will retry via batch.");
    }

    // ── 10. Advance company to verified ───────────────────────────────────────

    await updateCompany(companyId, {
      onboardingStatus: "verified",
      verifiedAt:       now,
      anchorTxHash:     anchorTxHash || undefined,
      anchorBlockNumber: anchorBlockNumber || undefined,
    });

    // ── 11. Respond ───────────────────────────────────────────────────────────

    res.status(200).json({
      ok:              true,
      companyId,
      domain:          company.domain,
      status:          "verified",
      credentialId,
      kmsKeyName:      keyName,
      anchorRoot:      root,
      anchorTxHash:    anchorTxHash || null,
      anchorBlockNumber: anchorBlockNumber || null,
      verifiedAt:      now,
    });
  };
}