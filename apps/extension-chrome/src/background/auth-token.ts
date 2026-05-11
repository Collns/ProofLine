/**
 * @file auth-token.ts
 * @module apps/extension-chrome/src/background
 *
 * Get-or-issue logic for the long-lived extension auth token.
 *
 * Per TDD §11.4 / PRD §11.4 — every call from the extension to the
 * server (and from the popup back to /v1/sign*) carries a Bearer token
 * that proves "this install belongs to user X at company Y". The token
 * itself is a JWS issued by the popup's `/extension/auth` ceremony.
 *
 * Lifecycle:
 *   1. First call: storage is empty → open auth ceremony popup → popup
 *      runs the install flow and posts back `auth_success` → manager
 *      persists the AuthTokenRecord → this module returns the token.
 *   2. Subsequent calls: storage has a record with `exp` > now+60s →
 *      return cached token without opening any UI.
 *   3. Token nearing expiry: opens a fresh auth ceremony to renew.
 *   4. User cancels the auth popup or device fails: returns null. Caller
 *      decides whether to surface a UI prompt or abort the sign flow.
 *
 * This module owns the auth-only orchestration. Sign-flow ceremonies
 * are launched by `popup-launcher.ts`, which calls `getOrIssueAuthToken`
 * to populate the `extToken` URL param.
 */

import { runCeremony } from "./popup-manager.js";
import {
  clearAuthToken as storageClearAuthToken,
  getAuthToken  as storageGetAuthToken,
  type AuthTokenRecord,
} from "./session-store.js";

// 60-second skew — refresh proactively so we never hand a near-expired
// token to the popup.
const REFRESH_SKEW_SEC = 60;

/**
 * Return a non-empty extension auth token, opening the auth ceremony
 * if necessary. Returns null only if the user cancelled the popup or
 * the ceremony surfaced an error — caller must handle that as a hard
 * stop rather than retrying in a loop.
 */
export async function getOrIssueAuthToken(): Promise<string | null> {
  const cached = await getCachedAuthRecord();
  if (cached) return cached.token;

  // No usable cached token — run the auth ceremony. popup-manager's
  // handleCeremonyMessage will write the AuthTokenRecord to storage on
  // success, so we can re-read it after the promise resolves.
  try {
    const response = await runCeremony({ kind: "auth" });
    if (response.kind !== "auth_success") {
      return null;
    }
    const persisted = await storageGetAuthToken();
    return persisted?.token ?? response.authToken;
  } catch {
    // USER_CANCELLED, CEREMONY_TIMEOUT, etc. — surface as null so the
    // launcher can short-circuit cleanly.
    return null;
  }
}

/**
 * Read-only accessor — never opens a popup. Returns null if no token
 * is stored or the stored token is expired.
 */
export async function getAuthToken(): Promise<AuthTokenRecord | null> {
  return await getCachedAuthRecord();
}

/**
 * True if the currently cached token has > 60s of life remaining.
 * Useful for "should I show 'Connected'?" UI without triggering a
 * ceremony.
 */
export async function isAuthTokenValid(): Promise<boolean> {
  return (await getCachedAuthRecord()) !== null;
}

export async function clearAuthToken(): Promise<void> {
  await storageClearAuthToken();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function getCachedAuthRecord(): Promise<AuthTokenRecord | null> {
  const record = await storageGetAuthToken();
  if (!record) return null;
  // Refresh skew: treat tokens within 60s of expiry as already gone.
  if (Math.floor(Date.now() / 1000) + REFRESH_SKEW_SEC >= record.exp) {
    await storageClearAuthToken();
    return null;
  }
  return record;
}
