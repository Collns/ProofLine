/**
 * @file shape-response.ts
 * @module apps/functions/src/verify
 *
 * Bridges VerificationResult (rich, contains bigints) into
 * VerificationResponse (HTTP-safe JSON, what apps/web-verify consumes).
 *
 * Mapping rules:
 *   ok:true  + state 'verified'|'bilateral' → passthrough signers/payload,
 *                                             stringify anchor.{blockNumber,timestamp}
 *   ok:true  + state 'suspected_spoof'      → passthrough claimedCompany + detail
 *   ok:false                                → passthrough code + detail
 *   (no envelope at id) → handler emits 'unverified_sender' directly
 *                         via unverified-sender.ts; this module never sees that case.
 *
 * Signer hydration: VerifiedSignerInfo already carries companyDomain,
 * companyLegalName, and userDisplayName — verifyEnvelope populates them
 * from the registry. shapeResponse is therefore mostly a passthrough for
 * signers; we copy the array defensively to avoid leaking internal references.
 */

import type {
  VerificationResult,
  VerifiedSignerInfo,
  Anchor,
} from "@proofline/verification";
import type { VerificationResponse, SerializedAnchor } from "./contract.js";

function serializeAnchor(anchor: Anchor): SerializedAnchor {
  return {
    root: anchor.root,
    blockNumber: anchor.blockNumber.toString(),
    timestamp: anchor.timestamp.toString(),
  };
}

function copySigners(signers: VerifiedSignerInfo[]): VerifiedSignerInfo[] {
  return signers.map((s) => ({ ...s }));
}

export function shapeResponse(result: VerificationResult): VerificationResponse {
  if (!result.ok) {
    return {
      ok: false,
      state: "rejected",
      code: result.code,
      detail: result.detail,
    };
  }

  if (result.state === "suspected_spoof") {
    return {
      ok: true,
      state: "suspected_spoof",
      claimedCompany: { ...result.claimedCompany },
      detail: result.detail,
    };
  }

  // verified | bilateral — both carry signers, payload, anchor.
  return {
    ok: true,
    state: result.state,
    signers: copySigners(result.signers),
    payload: result.payload,
    anchor: serializeAnchor(result.anchor),
  };
}
