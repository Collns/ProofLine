/**
 * @file popup-manager.ts
 * @module apps/extension-chrome/src/background
 *
 * Opens, tracks, and closes WebAuthn ceremony popups on the web-sign
 * origin. This is the underlying state-machine for the launcher
 * (`popup-launcher.ts`) — it manages the chrome.windows lifecycle, the
 * pending-ceremony map, and the chrome.runtime.onMessageExternal
 * correlation.
 *
 * Why this exists (ADR-0012, TDD §11.4):
 *   - The extension's content script runs on mail.google.com, so any
 *     WebAuthn ceremony invoked there would have RP ID = "google.com",
 *     which is not what ProofLine credentials are bound to.
 *   - The fix is to open a popup window pointing at proofline.web.app,
 *     where the RP ID matches the user's enrolled credential.
 *   - The popup runs the ceremony (signing or auth), then sends
 *     the result back to the extension via chrome.runtime.sendMessage
 *     using the externally_connectable manifest entry.
 *
 * Lifecycle:
 *   1. Caller invokes runCeremony({kind, ...}) — returns a Promise.
 *   2. Generate ceremonyId (UUIDv4).
 *   3. chrome.windows.create() opens `${signOrigin}/<route>` with the
 *      full URL-param set in ceremony.types.ts CeremonyRequestParams.
 *   4. Track the pending ceremony in a Map keyed by ceremonyId.
 *   5. handleCeremonyMessage routes the popup's reply back to the
 *      ceremonyId's resolver.
 *   6. Close the popup window. Clear timeouts.
 *   7. If the user closes the popup window without sending a response,
 *      reject with USER_CANCELLED.
 *   8. If no response within CEREMONY_TIMEOUT_MS, reject with TIMEOUT.
 */

import { CONFIG } from "../shared/config.js";
import type {
  CeremonyKind,
  CeremonyRequestParams,
  CeremonyResponse,
  PendingCeremony,
} from "../shared/ceremony.types.js";
import { setAuthToken } from "./session-store.js";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Map of ceremonyKind → URL path on CONFIG.signOrigin. */
const CEREMONY_ROUTES: Record<CeremonyKind, string> = {
  fresh:  "/sign/start",
  silent: "/sign/silent",
  auth:   "/extension/auth",
};

/** Hard timeout — if the popup doesn't post back within this window, fail. */
const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes

/** Visible popup dimensions. */
const POPUP_WIDTH  = 480;
const POPUP_HEIGHT = 720;

/**
 * Silent ceremonies open a 1x1 minimized window so the popup can run
 * its WebAuthn assertion without stealing focus. Chrome enforces a
 * minimum window size, so 1x1 is treated as "smallest possible".
 */
const SILENT_POPUP_WIDTH  = 1;
const SILENT_POPUP_HEIGHT = 1;

// 30 days, in seconds. PRD §11.4 — extension auth tokens are long-lived.
const AUTH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

// ─── Internal state ───────────────────────────────────────────────────────────

/**
 * Pending ceremonies keyed by ceremonyId. Lives on the service worker's
 * global scope; survives across event handler invocations within the
 * same SW activation. If the SW is killed mid-ceremony, the popup will
 * still post back, but the listener won't have anyone to resolve to —
 * that's the documented MV3 lifecycle limitation (see TDD §11.4 footnote).
 */
const pendingCeremonies = new Map<string, PendingCeremony>();

// ─── UUID v4 (no dependency on uuid pkg in extension bundle) ─────────────────

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes (shouldn't happen in MV3 / Chrome 120+).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunCeremonyInput {
  kind:              CeremonyKind;
  recipientSetHash?: string;
  payloadHash?:      string;
  payloadB64?:       string;
  credentialId?:     string;
  extToken?:         string;
  sessionToken?:     string;
}

/**
 * Open a popup ceremony and await its result.
 *
 * Throws if:
 *   - The user closes the popup before completing (USER_CANCELLED).
 *   - The popup doesn't respond within CEREMONY_TIMEOUT_MS (TIMEOUT).
 *   - The popup posts back an error (passes through the popup's code).
 */
export async function runCeremony(input: RunCeremonyInput): Promise<CeremonyResponse> {
  const ceremonyId = uuidv4();
  const params: CeremonyRequestParams = {
    kind:             input.kind,
    ceremonyId,
    extInstallId:     chrome.runtime.id,
    returnOrigin:     `chrome-extension://${chrome.runtime.id}`,
    recipientSetHash: input.recipientSetHash,
    payloadHash:      input.payloadHash,
    payloadB64:       input.payloadB64,
    credentialId:     input.credentialId,
    extToken:         input.extToken,
    sessionToken:     input.sessionToken,
  };

  const url      = buildCeremonyUrl(params);
  const isSilent = input.kind === "silent";

  // Open the popup BEFORE registering the pending ceremony so we have a
  // windowId to track. Silent ceremonies open a tiny minimized window so
  // they can run the WebAuthn assertion without stealing focus.
  const window = await chrome.windows.create({
    url,
    type:    "popup",
    width:   isSilent ? SILENT_POPUP_WIDTH  : POPUP_WIDTH,
    height:  isSilent ? SILENT_POPUP_HEIGHT : POPUP_HEIGHT,
    focused: !isSilent,
    state:   isSilent ? "minimized" : "normal",
  });

  if (window?.id == null) {
    throw new Error("CEREMONY_POPUP_FAILED: chrome.windows.create returned no windowId");
  }
  const windowId: number = window.id;

  return new Promise<CeremonyResponse>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingCeremonies.delete(ceremonyId);
      void closeWindowSafely(windowId);
      reject(new Error(`CEREMONY_TIMEOUT: ${input.kind} ceremony timed out after ${CEREMONY_TIMEOUT_MS}ms`));
    }, CEREMONY_TIMEOUT_MS);

    pendingCeremonies.set(ceremonyId, {
      ceremonyId,
      kind:      input.kind,
      windowId,
      resolve,
      reject,
      createdAt: Date.now(),
      timeoutId,
    });
  });
}

// ─── Listener — wired up in background/index.ts on SW startup ────────────────

/**
 * Handle a ceremony response from the popup. Returns true if the message
 * was a recognized ceremony response (regardless of whether we had a
 * pending entry for it).
 */
export async function handleCeremonyMessage(
  message: unknown,
): Promise<boolean> {
  if (!isCeremonyResponse(message)) return false;
  const response = message;

  const pending = pendingCeremonies.get(response.ceremonyId);
  if (!pending) {
    // Unknown ceremony — could be a stale popup or a service worker restart.
    console.warn("[popup-manager] Received response for unknown ceremonyId:", response.ceremonyId);
    return true;
  }

  // Clean up first so any side effects below can't double-fire.
  pendingCeremonies.delete(response.ceremonyId);
  if (pending.timeoutId) clearTimeout(pending.timeoutId);

  // Side effects that the rest of the extension needs persisted.
  try {
    if (response.kind === "auth_success") {
      const nowSec = Math.floor(Date.now() / 1000);
      await setAuthToken({
        token:        response.authToken,
        userId:       response.userId,
        companyId:    response.companyId,
        extInstallId: chrome.runtime.id,
        iat:          nowSec,
        exp:          nowSec + AUTH_TOKEN_TTL_SEC,
      });
    }
    // Session-token persistence is handled by the launcher (which knows
    // the recipientSetHash + hardCap). popup-manager intentionally does
    // not couple to that detail.
  } catch (err) {
    console.error("[popup-manager] Failed to persist ceremony result", err);
    // Don't reject — caller still gets the response and can decide.
  }

  void closeWindowSafely(pending.windowId);

  if (response.kind === "user_cancelled") {
    pending.reject(new Error("USER_CANCELLED: User closed the ceremony popup"));
  } else if (response.kind === "error") {
    pending.reject(new Error(`${response.code}: ${response.message}`));
  } else {
    pending.resolve(response);
  }
  return true;
}

/**
 * Detect when the user closes the popup window manually (without
 * completing the ceremony). Wired up via chrome.windows.onRemoved.
 */
export function handleWindowClosed(windowId: number): void {
  for (const [id, pending] of pendingCeremonies.entries()) {
    if (pending.windowId === windowId) {
      pendingCeremonies.delete(id);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(new Error("USER_CANCELLED: User closed the ceremony popup"));
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCeremonyUrl(params: CeremonyRequestParams): string {
  const path = CEREMONY_ROUTES[params.kind];
  const url  = new URL(CONFIG.signOrigin + path);
  url.searchParams.set("kind",         params.kind);
  url.searchParams.set("ceremonyId",   params.ceremonyId);
  url.searchParams.set("extInstallId", params.extInstallId);
  url.searchParams.set("returnOrigin", params.returnOrigin);
  if (params.recipientSetHash) url.searchParams.set("recipientSetHash", params.recipientSetHash);
  if (params.payloadHash)      url.searchParams.set("payloadHash",      params.payloadHash);
  if (params.payloadB64)       url.searchParams.set("payloadB64",       params.payloadB64);
  if (params.credentialId)     url.searchParams.set("credentialId",     params.credentialId);
  if (params.extToken)         url.searchParams.set("extToken",         params.extToken);
  if (params.sessionToken)     url.searchParams.set("sessionToken",     params.sessionToken);
  return url.toString();
}

async function closeWindowSafely(windowId: number): Promise<void> {
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Window already closed by user or by previous remove() — ignore.
  }
}

function isCeremonyResponse(value: unknown): value is CeremonyResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || typeof v.ceremonyId !== "string") return false;
  return ["auth_success", "sign_success", "verify_success", "user_cancelled", "error"].includes(v.kind);
}

// ─── Test helpers (only for vitest — not used in production) ─────────────────

/** @internal */ export function _peekPending(): ReadonlyMap<string, PendingCeremony> {
  return pendingCeremonies;
}
/** @internal */ export function _clearPending(): void {
  for (const p of pendingCeremonies.values()) {
    if (p.timeoutId) clearTimeout(p.timeoutId);
  }
  pendingCeremonies.clear();
}
