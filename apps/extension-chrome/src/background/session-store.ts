/**
 * @file session-store.ts
 * @module apps/extension-chrome/src/background
 *
 * chrome.storage.local manager for ProofLine extension state.
 *
 * Per TDD §11.6 — the extension stores its tokens in chrome.storage.local
 * (NOT localStorage) for these reasons:
 *
 *   1. Isolated from Gmail's page context — Gmail JS cannot read it.
 *   2. Isolated from other extensions — Chromium scopes storage by extension.
 *   3. Persists across service worker restarts (MV3 service workers are
 *      non-persistent).
 *   4. Cleared automatically when the user uninstalls the extension.
 *
 * This module is the ONLY place that writes to chrome.storage.local for
 * auth and session state. All other code reads/writes via these typed
 * getters/setters.
 *
 * Key namespacing — every key owned by ProofLine is prefixed `proofline:`
 * so future cohabitation with other extension surfaces stays predictable:
 *
 *   proofline:auth-token            — AuthTokenRecord
 *   proofline:session:<rsHash>      — SessionEntry, one per recipient set
 *
 * Records are stored as a single structured value per logical key (not
 * exploded into one chrome.storage key per field). chrome.storage.local
 * happily round-trips JSON-shaped values; this keeps reads atomic.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthTokenRecord {
  token:        string;       // bearer / JWS extension auth token
  userId:       string;
  companyId:    string;
  extInstallId: string;       // chrome.runtime.id at issuance time
  iat:          number;       // unix seconds — issued at
  exp:          number;       // unix seconds — expires at
}

export interface SessionEntry {
  token:            string;   // JWS session token
  recipientSetHash: string;
  expiresAt:        number;   // unix ms — sliding-window expiry
  hardCapAt:        number;   // unix ms — non-extendable hard ceiling
  storedAt:         number;   // unix ms — when the extension persisted it
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_AUTH_TOKEN     = 'proofline:auth-token';
const SESSION_KEY_PREFIX = 'proofline:session:';

export function authTokenKey(): string {
  return KEY_AUTH_TOKEN;
}

export function sessionKey(recipientSetHash: string): string {
  return `${SESSION_KEY_PREFIX}${recipientSetHash}`;
}

// ─── Auth token ───────────────────────────────────────────────────────────────

export async function getAuthToken(): Promise<AuthTokenRecord | null> {
  const result = await chrome.storage.local.get(KEY_AUTH_TOKEN);
  const record = result[KEY_AUTH_TOKEN] as AuthTokenRecord | undefined;
  if (!isAuthTokenRecord(record)) return null;

  // Treat as expired once exp has passed — purge so callers don't see it again.
  if (Math.floor(Date.now() / 1000) > record.exp) {
    await clearAuthToken();
    return null;
  }
  return record;
}

export async function setAuthToken(record: AuthTokenRecord): Promise<void> {
  await chrome.storage.local.set({ [KEY_AUTH_TOKEN]: record });
}

export async function clearAuthToken(): Promise<void> {
  await chrome.storage.local.remove(KEY_AUTH_TOKEN);
}

function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === 'string' &&
    typeof v.userId === 'string' &&
    typeof v.companyId === 'string' &&
    typeof v.extInstallId === 'string' &&
    typeof v.iat === 'number' &&
    typeof v.exp === 'number'
  );
}

// ─── Session tokens (per recipient set) ──────────────────────────────────────

export async function getSession(recipientSetHash: string): Promise<SessionEntry | null> {
  const key    = sessionKey(recipientSetHash);
  const result = await chrome.storage.local.get(key);
  const entry  = result[key] as SessionEntry | undefined;
  if (!isSessionEntry(entry)) return null;

  if (Date.now() > entry.expiresAt || Date.now() > entry.hardCapAt) {
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

/**
 * Remove every per-recipient session token. Used on logout / device
 * revocation / role change — anywhere we need to invalidate all silent
 * paths in one shot. Auth token is left alone; pair with `clearAuthToken`
 * if you also want to log the user out.
 */
export async function clearAllSessions(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const sessionKeys = Object.keys(all).filter((k) => k.startsWith(SESSION_KEY_PREFIX));
  if (sessionKeys.length === 0) return;
  await chrome.storage.local.remove(sessionKeys);
}

function isSessionEntry(value: unknown): value is SessionEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === 'string' &&
    typeof v.recipientSetHash === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.hardCapAt === 'number' &&
    typeof v.storedAt === 'number'
  );
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
