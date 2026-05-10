/**
 * @file contract.ts
 * @module apps/functions/src/verify
 *
 * The HTTP response contract for GET /v1/verify/:id.
 *
 * Structurally identical to apps/web-verify/src/api/types.ts —
 * redeclared here because cross-app type imports are not a pattern
 * in this monorepo. If the consumer's contract changes, update both
 * sides in lockstep (a focused refactor could lift this into a shared
 * @proofline/* package later).
 */

import type {
  VerifiedSignerInfo,
  VerificationFailureCode,
} from "@proofline/verification";
import type {
  WirePayload,
  EmailPayload,
  BilateralPayload,
} from "@proofline/types";

export interface SerializedAnchor {
  root: string;
  blockNumber: string;
  timestamp: string;
}

export type VerificationResponse =
  | {
      ok: true;
      state: "verified" | "bilateral";
      signers: VerifiedSignerInfo[];
      payload: WirePayload | EmailPayload | BilateralPayload;
      anchor: SerializedAnchor;
    }
  | {
      ok: true;
      state: "suspected_spoof";
      claimedCompany: { companyId: string; domain: string; legalName: string };
      detail: string;
    }
  | {
      ok: false;
      state: "rejected";
      code: VerificationFailureCode;
      detail: string;
    }
  | {
      ok: true;
      state: "unverified_sender";
    };

export type VerificationState = VerificationResponse["state"];
