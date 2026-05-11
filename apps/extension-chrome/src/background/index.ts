/**
 * @file index.ts
 * @module apps/extension-chrome/src/background
 *
 * Service worker entry point.
 *
 * Responsibilities (in order of importance):
 *   1. Wire popup ceremony response listeners
 *      (chrome.runtime.onMessageExternal + chrome.windows.onRemoved).
 *   2. Route messages from content scripts (Gmail page) — primarily
 *      PAYLOAD_EXTRACTED, which kicks off the full sign flow:
 *      auth → fresh/silent ceremony → banner injection.
 *   3. Handle the extension action popup (popup.html) — status, logout.
 *
 * MV3 service workers are non-persistent — Chrome may kill us at any
 * time when idle. State that must survive lives in chrome.storage.local
 * (handled by session-store.ts). In-memory state (pendingCeremonies) is
 * only valid for the lifetime of one SW activation; if a ceremony is in
 * flight when the SW dies, the popup will still post back, but no
 * resolver will be there. The popup's UI handles that case by not
 * blocking on extension acknowledgement (see web-sign postmessage.ts).
 */

import type { EmailPayload } from "@proofline/types";
import { canonicalize } from "@proofline/canonical";

import {
  handleCeremonyMessage,
  handleWindowClosed,
} from "./popup-manager.js";
import { openPopupCeremony } from "./popup-launcher.js";
import {
  getAuthToken,
  getOrIssueAuthToken,
} from "./auth-token.js";
import {
  clearAllSessions,
  clearSession,
  getSession,
  logout,
  setSession,
} from "./session-store.js";
import { CONFIG } from "../shared/config.js";
import type {
  BackgroundToContentMessage,
  PartialEmailPayload,
} from "../shared/types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// Hard-cap floor for new sessions when the server doesn't echo one back.
// Sliding-window expiry will take precedence; this only fires if the
// server omits a hardCap and we need a non-Infinity ceiling.
const FALLBACK_SESSION_HARD_CAP_MS = 8 * 60 * 60 * 1000; // 8 hours

// Sliding-window default if /v1/sign/finalize doesn't echo expiresAt.
// 15 minutes per TDD §4.10 default.
const FALLBACK_SESSION_TTL_MS = 15 * 60 * 1000;

// ─── External-message listener (popup → extension) ──────────────────────────

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Validate origin one more time — defense in depth. The manifest
  // already restricts who can talk to us, but Chrome occasionally
  // surfaces sender.origin from prerender / fenced-frame contexts;
  // sender.url is the canonical field.
  const url = sender.url ?? "";
  if (!url.startsWith(`${CONFIG.signOrigin}/`)) {
    sendResponse({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    return false;
  }

  void handleCeremonyMessage(message).then((handled) => {
    sendResponse({ ok: handled });
  });
  return true; // async response
});

chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowClosed(windowId);
});

// ─── Internal-message listener (content script / action popup) ──────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      const result = await routeContentMessage(message, sender);
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
});

interface ContentRouteResult {
  status?:        string;
  signed?:        boolean;
  loggedOut?:     boolean;
  authenticated?: boolean;
}

async function routeContentMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<ContentRouteResult> {
  const msg = message as { type?: string } & Record<string, unknown>;
  if (!msg || typeof msg.type !== "string") {
    throw new Error("MALFORMED_MESSAGE");
  }

  switch (msg.type) {
    case "PING":
      return { status: "pong" };

    case "GET_AUTH_STATUS": {
      const auth = await getAuthToken();
      return { authenticated: auth !== null };
    }

    case "GET_SESSION_STATUS": {
      const rs = msg["recipientSetHash"];
      if (typeof rs !== "string") throw new Error("recipientSetHash required");
      const session = await getSession(rs);
      return { status: session ? "active" : "absent" };
    }

    case "BEGIN_AUTH": {
      // First-time auth: opens the auth ceremony popup. Resolves with
      // an AuthSuccess response or rejects (USER_CANCELLED / TIMEOUT /
      // server error). Caller of routeContentMessage maps that to a
      // BackgroundResponse for the action popup UI.
      await openPopupCeremony({ kind: "auth" });
      return { authenticated: true };
    }

    case "LOGOUT": {
      await logout();
      return { loggedOut: true };
    }

    case "CLEAR_SESSIONS": {
      await clearAllSessions();
      return { status: "cleared" };
    }

    case "SIGN_BUTTON_CLICKED":
      // Stub-ack only — the real flow runs from PAYLOAD_EXTRACTED, which
      // arrives shortly after with the canonical payload bytes. Keeping
      // the stub for backwards compatibility with PFL-042 sweep tests.
      return { status: "ack" };

    case "EXTRACTION_FAILED": {
      // Surface to the popup / log; nothing else to do here. Content
      // script already shows the user a notice.
      return { status: "noted" };
    }

    case "PAYLOAD_EXTRACTED": {
      const composeId      = stringOrThrow(msg["composeId"], "composeId");
      const partialPayload = msg["partialPayload"] as PartialEmailPayload | undefined;
      if (!partialPayload || typeof partialPayload !== "object") {
        throw new Error("partialPayload required");
      }
      // Fire-and-forget: do not block onMessage's reply on the entire
      // sign flow (which can take 60s+). We immediately ack receipt;
      // results land back on the tab via tabs.sendMessage when ready.
      void runSignFlow({
        composeId,
        partialPayload,
        tabId: sender.tab?.id ?? null,
      }).catch((err) => {
        const code    = err instanceof Error ? extractErrCode(err.message) : "INTERNAL";
        const detail  = err instanceof Error ? err.message : String(err);
        if (sender.tab?.id != null) {
          void postToTab(sender.tab.id, {
            type: "SIGN_FAILED",
            composeId,
            code,
            message: detail,
          });
        }
        console.error("[background] sign flow failed", { composeId, code, detail });
      });
      return { status: "started" };
    }

    default:
      throw new Error(`UNKNOWN_MESSAGE_TYPE: ${msg.type}`);
  }
}

// ─── Sign flow orchestrator ──────────────────────────────────────────────────

interface RunSignFlowInput {
  composeId:      string;
  partialPayload: PartialEmailPayload;
  tabId:          number | null;
}

/**
 * The full popup-driven sign flow:
 *
 *   1. Resolve the user's identity from the auth token (from + companyId).
 *   2. Build the canonical EmailPayload, base64url-encode it, hash it.
 *   3. Compute recipientSetHash from the To list.
 *   4. Look up an existing session token for that recipient set.
 *   5. Open a fresh or silent popup ceremony with the full URL-param set.
 *   6. On success, persist any new session token returned by the popup
 *      and relay the rendered banner HTML to the originating tab.
 *
 * Errors propagate to the caller, which posts a SIGN_FAILED message
 * back to the content script.
 */
async function runSignFlow(input: RunSignFlowInput): Promise<void> {
  // Try to get cached auth; if missing, open the auth ceremony popup.
  const token = await getOrIssueAuthToken();
  if (!token) {
    throw new Error("AUTH_REQUIRED: user cancelled or auth failed");
  }
  const auth = await getAuthToken();
  if (!auth) {
    throw new Error("AUTH_REQUIRED: token issued but record missing");
  }

  const credentialId = await resolveCredentialId();
  if (!credentialId) {
    throw new Error("CREDENTIAL_MISSING: no WebAuthn credentialId on file");
  }

  const fullPayload: EmailPayload = {
    ...input.partialPayload,
    from:      `${auth.userId}@${auth.companyId}`,  // placeholder — see TODO
    companyId: auth.companyId,
  };
  // TODO(PFL-AUTH-LOGIN): the auth-success record currently lacks a
  // distinct `email` field, so we synthesize a placeholder. The real
  // /extension/auth response will include the user's email.

  const canonicalBytes = canonicalize(fullPayload);
  const payloadHash    = await sha256Hex(canonicalBytes);
  const payloadB64     = base64UrlEncode(canonicalBytes);
  const rsh            = await computeRecipientSetHash(fullPayload.to);

  const existing = await getSession(rsh);
  const kind: "fresh" | "silent" = existing ? "silent" : "fresh";

  let response;
  try {
    response = await openPopupCeremony({
      kind,
      payloadB64,
      payloadHash,
      recipientSetHash: rsh,
      credentialId,
      sessionToken: existing?.token,
    });
  } catch (err) {
    // Common case: a stored session was rejected by the server (e.g.
    // expired between our cache check and the popup's call). Drop the
    // cached entry so the next attempt takes the fresh path.
    if (kind === "silent") await clearSession(rsh);
    throw err;
  }

  if (response.kind !== "sign_success") {
    throw new Error(
      `UNEXPECTED_RESPONSE: kind=${response.kind} from popup ceremony`,
    );
  }

  if (response.sessionToken) {
    await setSession({
      token:            response.sessionToken,
      recipientSetHash: rsh,
      expiresAt:        Date.now() + FALLBACK_SESSION_TTL_MS,
      hardCapAt:        Date.now() + FALLBACK_SESSION_HARD_CAP_MS,
      storedAt:         Date.now(),
    });
  }

  if (input.tabId != null) {
    await postToTab(input.tabId, {
      type:       "PAYLOAD_SIGNED",
      composeId:  input.composeId,
      bannerHtml: response.banner,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stringOrThrow(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} required`);
  return value;
}

function extractErrCode(msg: string): string {
  // Conventionally "<CODE>: <detail>" — pull the prefix.
  const idx = msg.indexOf(":");
  return idx > 0 ? msg.slice(0, idx) : msg;
}

async function postToTab(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Tab closed, content script ungrabbed, etc. — non-fatal.
    console.warn("[background] tabs.sendMessage failed", err);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const buf  = await crypto.subtle.digest("SHA-256", view);
  const arr  = new Uint8Array(buf);
  let out    = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Decode bytes as latin-1 string for btoa (which is byte-oriented).
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * SHA-256 over JSON.stringify of trim/lowercase/sorted To list. Mirrors
 * packages/sessions/src/recipient-set.ts exactly so the extension's
 * hash agrees with the server's.
 */
export async function computeRecipientSetHash(toAddresses: string[]): Promise<string> {
  if (toAddresses.length === 0) {
    throw new Error("recipientSetHash: empty toAddresses");
  }
  const normalized = toAddresses.map((a) => a.trim().toLowerCase()).sort();
  const json = JSON.stringify(normalized);
  return await sha256Hex(new TextEncoder().encode(json));
}

/**
 * Resolve the user's WebAuthn credentialId for sign ceremonies.
 *
 * Real source of truth is the registry / auth response — for now we
 * read a stashed value from chrome.storage.local under a fixed key.
 * The auth ceremony will populate this once /extension/auth ships its
 * full response shape (PFL-AUTH-LOGIN).
 */
async function resolveCredentialId(): Promise<string | null> {
  const result = await chrome.storage.local.get("proofline:credentialId");
  const value  = result["proofline:credentialId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ─── Lifecycle hooks ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ProofLine] Extension installed/updated", details.reason);
});

console.log("[ProofLine] Background service worker ready");
