/**
 * @file popup-launcher.ts
 * @module apps/extension-chrome/src/background
 *
 * Public façade for launching popup ceremonies. Combines:
 *
 *   - auth-token.ts          — fetches the extToken (running an auth
 *                               ceremony first if storage is empty)
 *   - popup-manager.ts        — opens the popup, tracks the pending
 *                               ceremony, validates message correlation
 *   - session-store.ts (read) — used by callers to know whether to
 *                               request 'fresh' or 'silent'; this module
 *                               does not auto-pick the kind
 *
 * Why a separate file from popup-manager:
 *   - popup-manager owns the chrome.windows + onMessageExternal
 *     state machine and is unit-testable without auth-token coupling.
 *   - popup-launcher composes auth + popup-manager into the public
 *     `openPopupCeremony` API the rest of the extension calls.
 *
 * Auth bootstrap:
 *   - `kind: 'auth'` skips the auth-token fetch (you can't fetch a
 *     token before you have one — that's what 'auth' is for).
 *   - `kind: 'fresh' | 'silent'` requires a valid extToken; if storage
 *     is empty the launcher opens an auth ceremony first, then proceeds.
 *     If the user cancels auth, openPopupCeremony rejects with
 *     AUTH_REQUIRED so the caller can surface a re-auth prompt.
 */

import type { CeremonyResponse } from "../shared/ceremony.types.js";
import { getOrIssueAuthToken } from "./auth-token.js";
import { runCeremony, type RunCeremonyInput } from "./popup-manager.js";

export interface OpenPopupCeremonyInput {
  kind:              "fresh" | "silent" | "auth";
  payloadB64?:       string;       // canonical EmailPayload as base64url JSON
  payloadHash?:      string;       // sha256-hex of canonical bytes
  recipientSetHash?: string;       // sha256-hex of normalized recipient list
  credentialId?:     string;       // user's WebAuthn credentialId
  sessionToken?:     string;       // silent only — proves an active session
}

/**
 * Open a ceremony popup and resolve when the popup posts back a
 * matching response. Rejects on user cancellation, timeout, or an
 * explicit error response from the popup (e.g. POLICY_DENIED).
 */
export async function openPopupCeremony(
  input: OpenPopupCeremonyInput,
): Promise<CeremonyResponse> {
  const ceremonyInput: RunCeremonyInput = {
    kind:             input.kind,
    payloadB64:       input.payloadB64,
    payloadHash:      input.payloadHash,
    recipientSetHash: input.recipientSetHash,
    credentialId:     input.credentialId,
    sessionToken:     input.sessionToken,
  };

  // Auth ceremony bootstraps its own credentials — no token needed.
  if (input.kind !== "auth") {
    const extToken = await getOrIssueAuthToken();
    if (!extToken) {
      throw new Error(
        "AUTH_REQUIRED: extension auth token is missing or could not be issued.",
      );
    }
    ceremonyInput.extToken = extToken;
  }

  return await runCeremony(ceremonyInput);
}
