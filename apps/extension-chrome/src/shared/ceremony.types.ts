/**
 * @file ceremony.types.ts
 * @module apps/extension-chrome/src/shared
 *
 * Shared types for the WebAuthn ceremony bridge between the
 * background service worker and the popup window on proofline.app.
 *
 * Per ADR-0012 / TDD §11.4:
 *   - Extension cannot run WebAuthn directly from mail.google.com
 *     because the RP ID would be wrong.
 *   - All WebAuthn ceremonies happen in a popup window opened on
 *     https://app.proofline.web.app, where the RP ID matches.
 *   - The popup posts the ceremony result back to the extension
 *     via chrome.runtime.sendMessage (preferred over postMessage
 *     in MV3, as the popup has externally_connectable access).
 */

// Change line 18 of ceremony.types.ts to:
import type { SignedEnvelope } from "@proofline/types";

// Minimal shape — full type lives in @proofline/verification
type VerificationResult = unknown;

// ─── Ceremony kinds ───────────────────────────────────────────────────────────

export type CeremonyKind =
  | "fresh"   // /sign/start  — full WebAuthn ceremony, opens session
  | "silent" // /sign/silent — uses existing session, no biometric
  | "auth"; // /extension/auth — first-time extension authentication

// ─── Request from background → popup (via URL params) ─────────────────────────

export interface CeremonyRequestParams {
  kind:              CeremonyKind;
  ceremonyId:        string;          // uuid v7, used to correlate response
  extInstallId:      string;          // chrome.runtime.id
  recipientSetHash?: string;          // for fresh/silent only
  payloadHash?:      string;          // hash of canonical email payload
  returnOrigin:      string;          // chrome-extension://<id>
}

// ─── Response from popup → extension (via chrome.runtime.sendMessage) ─────────

export type CeremonyResponse =
  | { kind: "auth_success";    ceremonyId: string; authToken: string;   userId: string; companyId: string }
  | { kind: "sign_success";    ceremonyId: string; envelope: SignedEnvelope; banner: string; sessionToken?: string }
  | { kind: "verify_success";  ceremonyId: string; result: VerificationResult }
  | { kind: "user_cancelled";  ceremonyId: string }
  | { kind: "error";           ceremonyId: string; code: string; message: string };

// ─── Background internal — pending ceremony entry ────────────────────────────

export interface PendingCeremony {
  ceremonyId: string;
  kind:       CeremonyKind;
  windowId:   number;                                    // chrome.windows.Window id
  resolve:    (response: CeremonyResponse) => void;
  reject:     (err: Error) => void;
  createdAt:  number;
  timeoutId?: ReturnType<typeof setTimeout>;
}