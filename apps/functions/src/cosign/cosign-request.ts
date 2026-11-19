/**
 * @file cosign-request.ts
 * @module apps/functions/src/cosign
 *
 * PFL-136 — creating the cosign request when a wire is over the sender's
 * per-email limit.
 *
 *   1. /v1/sign returns COSIGN_REQUIRED together with the sender's own
 *      fresh-biometric challenge (the sender always signs first).
 *   2. /v1/sign/finalize records the envelope as PENDING_COSIGN with
 *      cosign.approverEmails, mints a cosign link (HS256 JWS, see
 *      cosign.helpers.ts) and emails it to those approvers.
 *   3. The approver opens the link on the sign app (web-sign /cosign/:id),
 *      which runs the pre-biometric checks and the passkey ceremony, then
 *      POST /v1/cosign/:id/finalize appends the second signature
 *      (status COSIGNED) and queues the anchor.
 *
 * Approvers are active owners/managers of the same company, excluding the
 * sender.
 */

import { getFirestore } from "firebase-admin/firestore";

import { mintCosignJws } from "./cosign.helpers.js";

export const DEFAULT_SIGN_APP_BASE_URL = "https://proofline-sign.web.app";

export interface CosignApprover {
  userId: string;
  email:  string;
}

export async function resolveCosignApprovers(
  companyId: string,
  excludeUserId: string,
): Promise<CosignApprover[]> {
  // Single-field query (no composite index needed); role/status filtered here.
  const snap = await getFirestore()
    .collection("users")
    .where("companyId", "==", companyId)
    .get();
  const out: CosignApprover[] = [];
  for (const d of snap.docs) {
    if (d.id === excludeUserId) continue;
    const u = d.data() as { email?: unknown; role?: unknown; status?: unknown };
    if (u.status !== "active" || (u.role !== "owner" && u.role !== "manager")) continue;
    if (typeof u.email === "string" && u.email.includes("@")) out.push({ userId: d.id, email: u.email.toLowerCase() });
  }
  return out;
}

export function cosignLink(baseUrl: string, messageId: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/cosign/${encodeURIComponent(messageId)}?t=${encodeURIComponent(token)}`;
}

export function mintCosignLinkToken(input: {
  companyId:   string;
  messageId:   string;
  payloadHash: string;
  ttlSec:      number;
  nowSec?:     number;
}): { token: string; exp: number } {
  const iat = input.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = iat + input.ttlSec;
  return {
    token: mintCosignJws({ iss: input.companyId, sub: input.messageId, payloadHash: input.payloadHash, iat, exp }),
    exp,
  };
}

/** Wire summary for the cosign email. Wire amounts are whole USD; the template expects cents. */
export function cosignEmailWire(payload: { wirePayload?: { amount: number; recipientAccount: string; recipientRouting: string; memo?: string } }) {
  const w = payload.wirePayload;
  return {
    amount:                Math.round((w?.amount ?? 0) * 100),
    recipientAccountLast4: (w?.recipientAccount ?? "").slice(-4),
    routingNumber:         w?.recipientRouting ?? "",
    ...(w?.memo ? { memo: w.memo } : {}),
  };
}
