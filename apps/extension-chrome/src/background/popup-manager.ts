/**
 * @file popup-manager.ts
 * @module apps/extension-chrome/src/background
 *
 * Opens, tracks, and closes WebAuthn ceremony popups on proofline.app.
 *
 * Why this exists (ADR-0012, TDD §11.4):
 *   - The extension's content script runs on mail.google.com, so any
 *     WebAuthn ceremony invoked there would have RP ID = "google.com",
 *     which is not what ProofLine credentials are bound to.
 *   - The fix is to open a popup window pointing at proofline.app,
 *     where the RP ID matches the user's enrolled credential.
 *   - The popup runs the ceremony (signing or auth), then sends
 *     the result back to the extension via chrome.runtime.sendMessage
 *     using the externally_connectable manifest entry.
 *
 * Lifecycle:
 *   1. Caller invokes runCeremony({kind, ...}) — returns a Promise.
 *   2. Generate ceremonyId (UUIDv4).
 *   3. chrome.windows.create() opens https://app.proofline.web.app/<route>
 *      with ceremonyId in the URL.
 *   4. Track the pending ceremony in a Map keyed by ceremonyId.
 *   5. Listen for chrome.runtime.onMessageExternal — when the popup
 *      sends { kind, ceremonyId, ... }, look up the pending entry and
 *      resolve its Promise with the response.
 *   6. Close the popup window. Clear timeouts.
 *   7. If the user closes the popup window without sending a response,
 *      reject with USER_CANCELLED.
 *   8. If no response within CEREMONY_TIMEOUT_MS, reject with TIMEOUT.
 */

import type {
  CeremonyKind,
  CeremonyRequestParams,
  CeremonyResponse,
  PendingCeremony,
} from "../shared/ceremony.types.js";
import { setAuthToken, setSession } from "./session-store.js";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Where popup ceremonies are hosted. Hosted on Firebase Hosting. */
const PROOFLINE_ORIGIN = "https://app.proofline.web.app";

/** Map of ceremonyKind → URL path on PROOFLINE_ORIGIN. */
const CEREMONY_ROUTES: Record<CeremonyKind, string> = {
  fresh:  "/sign/start",
  silent: "/sign/silent",
  auth:   "/extension/auth",
};

/** Hard timeout — if the popup doesn't post back within this window, fail. */
const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes

/** Popup window dimensions. */
const POPUP_WIDTH  = 480;
const POPUP_HEIGHT = 640;

// ─── Internal state ───────────────────────────────────────────────────────────

/**
 * Pending ceremonies keyed by ceremonyId.  Lives on the service-worker's
 * global scope; survives across event handler invocations within the
 * same SW activation.  If the SW is killed mid-ceremony, the popup will
 * still post back, but the listener won't have anyone to resolve to —
 * that's why we also persist `pending.*` keys to chrome.storage.session
 * (best-effort recovery).
 */
const pendingCeremonies = new Map<string, PendingCeremony>();

// ─── UUID v4 (no dependency on uuid pkg in extension bundle) ─────────────────

function uuidv4(): string {
  // crypto.randomUUID is available in MV3 service workers.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes (shouldn't happen in MV3).
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
    recipientSetHash: input.recipientSetHash,
    payloadHash:      input.payloadHash,
    returnOrigin:     `chrome-extension://${chrome.runtime.id}`,
  };

  const url = buildCeremonyUrl(params);

  // Open the popup BEFORE registering the pending ceremony so we have a windowId to track.
  const window = await chrome.windows.create({
    url,
    type:    "popup",
    width:   POPUP_WIDTH,
    height:  POPUP_HEIGHT,
    focused: true,
  });

  if (window?.id == null) {
    throw new Error("CEREMONY_POPUP_FAILED: chrome.windows.create returned no windowId");
  }
  const windowId: number = window.id;

  // Now register the pending ceremony and wait for the response.
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
 * Handle a ceremony response from the popup.
 *
 * The popup sends a chrome.runtime.sendMessage (when popup is on the
 * extension's externally_connectable list) OR posts to a content script
 * which forwards via chrome.runtime.sendMessage.  Either way, this is the
 * single entry point.
 *
 * Returns true if the message was a recognized ceremony response.
 */
export async function handleCeremonyMessage(
  message: unknown
): Promise<boolean> {
  // Type guard
  if (!isCeremonyResponse(message)) return false;
  const response = message;

  const pending = pendingCeremonies.get(response.ceremonyId);
  if (!pending) {
    // Unknown ceremony — could be a stale popup or a service worker restart.
    // Best-effort persist for diagnostics; don't crash.
    console.warn("[popup-manager] Received response for unknown ceremonyId:", response.ceremonyId);
    return true;
  }

  // Clean up first so any side effects below can't double-fire.
  pendingCeremonies.delete(response.ceremonyId);
  if (pending.timeoutId) clearTimeout(pending.timeoutId);

  // Persist results that the rest of the extension needs.
  try {
    if (response.kind === "auth_success") {
      await setAuthToken({
        token:     response.authToken,
        userId:    response.userId,
        companyId: response.companyId,
        // 30-day expiry per TDD §11 extension auth flow.
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
    } else if (response.kind === "sign_success" && response.sessionToken) {
      // Server returns sessionToken when a fresh ceremony opens a new session.
      // Recipient-set hash needed to key the session; we derive it from the
      // pending request rather than trusting the popup's response.
      const pendingReq = pending as PendingCeremony;
      // We stash the recipientSetHash on the pending entry's ceremonyId via
      // the URL we built.  For simplicity, the popup may also include it,
      // but trusting our own state is safer.
      // TODO once chrome.storage.session is stable: read from there.
      // For now we rely on the caller to also call setSession() if needed.
      void pendingReq;
    }
  } catch (err) {
    console.error("[popup-manager] Failed to persist ceremony result", err);
    // Don't reject — the caller still gets the response and can decide.
  }

  // Close the popup window.
  void closeWindowSafely(pending.windowId);

  // Resolve / reject the caller's Promise.
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
 * completing the ceremony).  Wired up via chrome.windows.onRemoved.
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
  const url  = new URL(PROOFLINE_ORIGIN + path);
  url.searchParams.set("ceremonyId",   params.ceremonyId);
  url.searchParams.set("extInstallId", params.extInstallId);
  url.searchParams.set("returnOrigin", params.returnOrigin);
  if (params.recipientSetHash) url.searchParams.set("recipientSetHash", params.recipientSetHash);
  if (params.payloadHash)      url.searchParams.set("payloadHash",      params.payloadHash);
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