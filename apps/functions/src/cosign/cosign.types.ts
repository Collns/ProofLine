/**
 * @file cosign.types.ts
 * @module apps/functions/src/cosign
 *
 * Wire-format types for /v1/cosign/* — mirrors the client contract in
 * apps/web-counterparty/src/api/types.ts. Kept as a local copy because
 * the counterparty app is not a workspace dep of @proofline/functions.
 * Both sides MUST agree; any drift is a runtime contract bug.
 *
 * Types are intentionally `unknown`-shaped on `envelope.payload` so we
 * don't pull every payload variant's Zod schema in here — the handler
 * passes envelope payloads through verbatim from Firestore.
 */

export interface CosignSignerInfo {
  userId:           string;
  credentialId:     string;
  signedAt:         number; // unix seconds
  userDisplayName:  string;
  companyId:        string;
  companyDomain:    string;
  companyLegalName: string;
}

export type CosignFailureCode =
  | "COSIGN_LINK_EXPIRED"
  | "COSIGN_LINK_INVALID"
  | "ALREADY_COSIGNED"
  | "POLICY_REJECTED"
  | "NOT_FOUND"
  | "NETWORK_ERROR";

export type CosignContextResponse =
  | {
      ok:              true;
      messageId:       string;
      envelope:        unknown;
      payloadHash:     string;
      payloadType:     "wire" | "email" | "bilateral";
      payload:         unknown;
      signer:          CosignSignerInfo;
      expiresAt:       number;       // unix seconds — echoed JWS exp
      cosignChallenge: string;       // base64url challenge bytes
    }
  | {
      ok:     false;
      code:   CosignFailureCode;
      detail: string;
    };

export type FinalizeCosignResponse =
  | {
      ok:               true;
      messageId:        string;
      anchorWillFollow: boolean;
    }
  | {
      ok:     false;
      code:   CosignFailureCode | "ASSERTION_INVALID";
      detail: string;
    };

export type RefreshLinkResponse =
  | { ok: true; freshLinkSent: boolean }
  | { ok: false; code: CosignFailureCode; detail: string };
