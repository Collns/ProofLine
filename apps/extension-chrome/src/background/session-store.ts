/**
 * @file session-store.ts
 * @module apps/extension-chrome/src/background
 *
 * chrome.storage.local manager for ProofLine extension state.
 *
 * Per TDD §11.6 — the extension stores its tokens in
 * chrome.storage.local (NOT localStorage) for these reasons:
 *
 *   1. Isolated from Gmail's page context — Gmail JS cannot read it.
 *   2. Isolated from other extensions — Chromium scopes storage by extension.
 *   3. Persists across service worker restarts (MV3 service workers are non-persistent).
 *   4. Cleared automatically when the user uninstalls the extension.
 *
 * This module is the ONLY place that writes to chrome.storage.local.
 * All other code reads/writes via these typed getters/setters.
 *
 * Storage shape:
 *   {
 *     "auth.token":          string         — JWS extension auth token (30-day TTL)
 *     "auth.userId":         string
 *     "auth.companyId":      string
 *     "auth.expiresAt":      number         — unix ms
 *     "session.<rsHash>":    SessionEntry   — per recipient-set
 *   }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthTokenRecord {
  token:     string;
  userId:    string;
  companyId: string;
  expiresAt: number;
}

export interface SessionEntry {
  token:            string;     // JWS session token
  recipientSetHash: string;
  expiresAt:        number;     // unix ms (sliding window)
  createdAt:        number;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_AUTH_TOKEN     = "auth.token";
const KEY_AUTH_USER_ID   = "auth.userId";
const KEY_AUTH_COMPANY   = "auth.companyId";
const KEY_AUTH_EXPIRES   = "auth.expiresAt";
const SESSION_KEY_PREFIX = "session.";

function sessionKey(recipientSetHash: string): string {
  return `${SESSION_KEY_PREFIX}${recipientSetHash}`;
}

// ─── Auth token ───────────────────────────────────────────────────────────────

export async function getAuthToken(): Promise<AuthTokenRecord | null> {
  const result = await chrome.storage.local.get([
    KEY_AUTH_TOKEN, KEY_AUTH_USER_ID, KEY_AUTH_COMPANY, KEY_AUTH_EXPIRES,
  ]);

  const token     = result[KEY_AUTH_TOKEN];
  const userId    = result[KEY_AUTH_USER_ID];
  const companyId = result[KEY_AUTH_COMPANY];
  const expiresAt = result[KEY_AUTH_EXPIRES];

  if (typeof token !== "string" || typeof userId !== "string" ||
      typeof companyId !== "string" || typeof expiresAt !== "number") {
    return null;
  }

  if (Date.now() > expiresAt) {
    // Expired — clean it up.
    await clearAuthToken();
    return null;
  }

  return { token, userId, companyId, expiresAt };
}

export async function setAuthToken(record: AuthTokenRecord): Promise<void> {
  await chrome.storage.local.set({
    [KEY_AUTH_TOKEN]:   record.token,
    [KEY_AUTH_USER_ID]: record.userId,
    [KEY_AUTH_COMPANY]: record.companyId,
    [KEY_AUTH_EXPIRES]: record.expiresAt,
  });
}

export async function clearAuthToken(): Promise<void> {
  await chrome.storage.local.remove([
    KEY_AUTH_TOKEN, KEY_AUTH_USER_ID, KEY_AUTH_COMPANY, KEY_AUTH_EXPIRES,
  ]);
}

// ─── Session tokens (per recipient set) ──────────────────────────────────────

export async function getSession(recipientSetHash: string): Promise<SessionEntry | null> {
  const key    = sessionKey(recipientSetHash);
  const result = await chrome.storage.local.get(key);
  const entry  = result[key] as SessionEntry | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return entry;
}

export async function setSession(entry: SessionEntry): Promise<void> {
  await chrome.storage.local.set({ [sessionKey(entry.recipientSetHash)]: entry });
}

export async function clearSession(recipientSetHash: string): Promise<void> {
  await chrome.storage.local.remove(sessionKey(recipientSetHash));
}

// ─── Logout — clears every key owned by this extension ────────────────────────

export async function logout(): Promise<void> {
  // chrome.storage.local.clear() removes everything — appropriate on logout
  // because we want sessions, auth token, and any cached state gone.
  await chrome.storage.local.clear();
}

// ─── Diagnostics (used by tests + the action popup) ───────────────────────────

export async function dumpAll(): Promise<Record<string, unknown>> {
  return await chrome.storage.local.get(null);
}