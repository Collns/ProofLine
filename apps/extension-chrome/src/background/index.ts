/**
 * @file index.ts
 * @module apps/extension-chrome/src/background
 *
 * Service worker entry point.
 *
 * This file is the bundle target referenced from manifest.json's
 * `background.service_worker` field.  It must be self-contained
 * (no top-level dynamic imports) and side-effectful — registering
 * chrome.* event listeners at module-load time.
 *
 * Responsibilities (in order of importance):
 *   1. Wire up popup ceremony response listeners
 *      (chrome.runtime.onMessageExternal + chrome.windows.onRemoved)
 *   2. Handle messages from content scripts (Gmail page) — SIGN_EMAIL,
 *      GET_SESSION_STATUS, GET_AUTH_STATUS, etc.
 *   3. Handle the action popup (popup.html) — show status, logout button.
 *
 * MV3 service workers are non-persistent — Chrome may kill us at any
 * time when idle. State that must survive lives in chrome.storage.local
 * (handled by session-store.ts). In-memory state (pendingCeremonies)
 * is only valid for the lifetime of one SW activation; if a ceremony
 * is in flight when the SW dies, the popup will still post back, but
 * we'll have no resolver — the popup's own UI must handle that case
 * by not waiting for confirmation from the extension.
 */

import { handleCeremonyMessage, handleWindowClosed, runCeremony } from "./popup-manager.js";
import {
  getAuthToken,
  getSession,
  logout,
} from "./session-store.js";

// ─── Listeners ────────────────────────────────────────────────────────────────

/**
 * Messages from the popup window (running on app.proofline.web.app)
 * arrive via chrome.runtime.onMessageExternal because they originate
 * from a different origin than the extension itself.
 *
 * The manifest's `externally_connectable.matches` list permits messages
 * from `https://*.proofline.web.app/*`.
 */
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    // Validate origin one more time — defense in depth.
    if (!sender.url || !sender.url.startsWith("https://app.proofline.web.app/")) {
      sendResponse({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
      return false;
    }

    void handleCeremonyMessage(message).then((handled) => {
      sendResponse({ ok: handled });
    });

    // Return true to indicate we'll call sendResponse asynchronously.
    return true;
  }
);

/**
 * Detect when the user closes a ceremony popup without completing it.
 */
chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowClosed(windowId);
});

/**
 * Messages from the content script (running on mail.google.com).
 * The content script never directly opens popups — it asks us to.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      const result = await routeContentMessage(message);
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;  // async response
});

// ─── Content script message router ───────────────────────────────────────────

interface ContentMessage {
  type:              string;
  recipientSetHash?: string;
  payloadHash?:      string;
}

async function routeContentMessage(
  message: unknown
): Promise<Record<string, unknown>> {
  if (!isContentMessage(message)) {
    throw new Error("MALFORMED_MESSAGE");
  }

  switch (message.type) {
    case "GET_AUTH_STATUS": {
      const auth = await getAuthToken();
      return { authenticated: auth !== null };
    }

    case "GET_SESSION_STATUS": {
      if (!message.recipientSetHash) throw new Error("recipientSetHash required");
      const session = await getSession(message.recipientSetHash);
      return {
        status: session ? "active" : "absent",
      };
    }

    case "BEGIN_AUTH": {
      // First-time extension auth — opens the auth popup.
      const response = await runCeremony({ kind: "auth" });
      return { response };
    }

    case "SIGN_EMAIL_FRESH": {
      if (!message.recipientSetHash) throw new Error("recipientSetHash required");
      if (!message.payloadHash)      throw new Error("payloadHash required");
      const response = await runCeremony({
        kind:             "fresh",
        recipientSetHash: message.recipientSetHash,
        payloadHash:      message.payloadHash,
      });
      return { response };
    }

    case "SIGN_EMAIL_SILENT": {
      if (!message.recipientSetHash) throw new Error("recipientSetHash required");
      if (!message.payloadHash)      throw new Error("payloadHash required");
      const response = await runCeremony({
        kind:             "silent",
        recipientSetHash: message.recipientSetHash,
        payloadHash:      message.payloadHash,
      });
      return { response };
    }

    case "LOGOUT": {
      await logout();
      return { loggedOut: true };
    }

    default:
      throw new Error(`UNKNOWN_MESSAGE_TYPE: ${message.type}`);
  }
}

function isContentMessage(value: unknown): value is ContentMessage {
  return typeof value === "object" && value !== null && typeof (value as any).type === "string";
}

// ─── Lifecycle hooks ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ProofLine] Extension installed/updated", details.reason);
});

// Surface a small diagnostic in the SW log so devs can confirm the
// worker booted successfully when reloading the extension.
console.log("[ProofLine] Background service worker ready");