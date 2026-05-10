import type { WirePayload, EmailPayload, BilateralPayload, SignedEnvelope } from '@proofline/types';

/**
 * Tentative client-side interpretation of the F-SIG-08 cosign deep-link
 * JWS. The server validates signature and `exp` — the client only decodes
 * to know what to fetch and to compare claimed payloadHash vs computed
 * (Step 4 of the F-SIG-09 verification checklist). Field names below may
 * shift when the server contract lands; treat as a working draft.
 */
export interface CosignLinkClaims {
  iss: string;          // companyId of the original signer's company (Sarah's company)
  sub: string;          // messageId — the envelope being cosigned
  payloadHash: string;  // sha256 hex of the canonical bytes the server stored
  iat: number;          // issued at, unix seconds
  exp: number;          // expiry, unix seconds
  kid?: string;         // company root key id used to sign the JWS
}

export interface CosignSignerInfo {
  userId: string;
  credentialId: string;
  signedAt: number;          // unix seconds
  userDisplayName: string;
  companyId: string;
  companyDomain: string;
  companyLegalName: string;
}

export type CosignContextResponse =
  | {
      ok: true;
      messageId: string;
      envelope: SignedEnvelope;
      payloadHash: string;
      payloadType: 'wire' | 'email' | 'bilateral';
      payload: WirePayload | EmailPayload | BilateralPayload;
      signer: CosignSignerInfo;
      expiresAt: number;          // unix seconds — JWS exp echoed back
      cosignChallenge: string;    // base64url challenge bytes for the WebAuthn assertion
    }
  | {
      ok: false;
      code: CosignFailureCode;
      detail: string;
    };

export type CosignFailureCode =
  | 'COSIGN_LINK_EXPIRED'
  | 'COSIGN_LINK_INVALID'
  | 'ALREADY_COSIGNED'
  | 'POLICY_REJECTED'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR';

export interface CosignAssertionPayload {
  /** AuthenticationResponseJSON from @simplewebauthn/browser. */
  assertion: unknown;
  /** Echoes the cosignChallenge the server issued — server re-binds. */
  challenge: string;
}

export type FinalizeCosignResponse =
  | {
      ok: true;
      messageId: string;
      anchorWillFollow: boolean;
    }
  | {
      ok: false;
      code: CosignFailureCode | 'ASSERTION_INVALID';
      detail: string;
    };

export type RefreshLinkResponse =
  | { ok: true; freshLinkSent: boolean }
  | { ok: false; code: CosignFailureCode; detail: string };
