/**
 * @file sign-status.handler.ts
 * @module apps/functions/src/signing
 *
 * GET /v1/sign/status/:envelopeId  (PFL-136)
 *
 * Lets the sender's extension check whether a wire that needed a cosigner
 * has been approved. Same-company callers only; anyone else gets 404.
 * Returns status (SIGNED | PENDING_COSIGN | COSIGNED), the signature count
 * and, while pending, when the cosign link expires. Once COSIGNED it also
 * returns the rendered two-signer banner, which the extension inserts into
 * the held compose before releasing the send.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";

import { renderBannerFromEnvelope } from "@proofline/email";

import { makeRFC7807Error } from "./http.helpers.js";
import { resolveSignerDisplayRecord, type EmailSignedEnvelope } from "./signing.helpers.js";

export function makeSignStatusHandler() {
  return async function signStatusHandler(req: express.Request, res: express.Response): Promise<void> {
    const envelopeId = String(req.params["envelopeId"] ?? "");
    const user = (req as express.Request & { user?: { companyId?: string } }).user;
    const notFound = () =>
      res.status(404).json(makeRFC7807Error("https://proofline.app/errors/NOT_FOUND", "NOT_FOUND", 404, "Envelope not found"));

    if (!envelopeId || !user?.companyId) {
      notFound();
      return;
    }
    const snap = await getFirestore().collection("signed_messages").doc(envelopeId).get();
    if (!snap.exists) {
      notFound();
      return;
    }
    const doc = snap.data() as {
      status?:     string;
      payload?:    { companyId?: string };
      signers?:    unknown[];
      signatures?: { signerId?: string; userId?: string }[];
      cosign?:     { linkExpiresAt?: number };
    };
    if (doc.payload?.companyId !== user.companyId) {
      notFound();
      return;
    }
    const signatureCount = Math.max(doc.signatures?.length ?? 0, doc.signers?.length ?? 0);

    let banner: string | undefined;
    if (doc.status === "COSIGNED" && Array.isArray(doc.signatures)) {
      const envelope = {
        ...(doc as unknown as EmailSignedEnvelope),
        envelopeId,
        signatures: doc.signatures.map((s) => ({ ...s, signerId: s.signerId ?? s.userId ?? "" })),
      } as EmailSignedEnvelope;
      const display = await Promise.all(envelope.signatures.map((s) => resolveSignerDisplayRecord(s.signerId)));
      banner = renderBannerFromEnvelope(envelope, display);
    }

    res.status(200).json({
      envelopeId,
      status:         doc.status ?? "SIGNED",
      signatureCount,
      ...(doc.status === "PENDING_COSIGN" && doc.cosign?.linkExpiresAt ? { linkExpiresAt: doc.cosign.linkExpiresAt } : {}),
      ...(banner ? { banner } : {}),
    });
  };
}
