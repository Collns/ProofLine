/**
 * @file session-status.ts
 * @module apps/extension-chrome/src/content
 *
 * Session status indicator for the compose toolbar (PFL-049, F-EXT-04).
 *
 * Renders a small pill immediately after the ProofLine "Sign" button showing:
 *   - 🔴 No active session
 *   - 🟢 Session active for mark@... · 12 min left
 *   - 🟡 Session expiring soon · 1 min left   (< SESSION_WARNING_MS)
 *
 * Updates come from two sources:
 *   1. Initial fetch via GET_SESSION_STATUS message to the background SW.
 *   2. Live updates via chrome.storage.onChanged — fires within ~100ms of
 *      a session being created or expiring in the background.
 *
 * The pill is idempotent — calling mountSessionStatus() on an already-mounted
 * compose is a no-op. The interval and storage listener are cleaned up when the
 * compose element is removed from the DOM (tracked via a MutationObserver).
 *
 * Architecture note: the content script cannot call chrome.storage.local
 * directly in the isolated world without the `storage` permission declared in
 * manifest.json. We already have that permission (used by session-store.ts in
 * the background). Content scripts CAN call chrome.storage.onChanged — it
 * fires for all storage changes regardless of which world made the write.
 */

import { log, warn } from '../shared/log.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Attribute on the compose element to track mounting. */
const STATUS_MOUNTED_ATTR = 'data-proofline-status-mounted';
/** Attribute on the pill element. */
const STATUS_PILL_ATTR = 'data-proofline-status-pill';
/** Refresh interval — how often we re-poll the background for time-left. */
const REFRESH_INTERVAL_MS = 15_000;
/** Show warning colour when this many ms remain. */
const SESSION_WARNING_MS = 2 * 60 * 1000; // 2 minutes
/** chrome.storage key prefix for session entries. */
const SESSION_KEY_PREFIX = 'proofline:session:';
/** chrome.storage key for the auth token. */
const AUTH_TOKEN_KEY = 'proofline:auth-token';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatusState =
  | { kind: 'no_session' }
  | { kind: 'active'; email: string; expiresAt: number }
  | { kind: 'expiring'; email: string; expiresAt: number }
  | { kind: 'no_auth' };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mounts a session status pill into the compose toolbar.
 * Call once per compose after the Sign button has been injected.
 *
 * @param compose   The compose container element.
 * @param toolbar   The toolbar element where the pill is appended.
 * @param recipients  Current To: addresses (used as recipientSetHash input).
 */
export function mountSessionStatus(
  compose: Element,
  toolbar: Element,
  recipients: string[],
): void {
  if (compose.getAttribute(STATUS_MOUNTED_ATTR) === 'true') return;
  compose.setAttribute(STATUS_MOUNTED_ATTR, 'true');

  const pill = buildPill();
  toolbar.appendChild(pill);

  // Initial render
  void fetchAndRender(pill, recipients);

  // Periodic refresh
  const interval = window.setInterval(() => {
    void fetchAndRender(pill, recipients);
  }, REFRESH_INTERVAL_MS);

  // Live storage changes — fires when background writes a new session
  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
  ) => {
    const keys = Object.keys(changes);
    const relevant = keys.some(
      (k) => k.startsWith(SESSION_KEY_PREFIX) || k === AUTH_TOKEN_KEY,
    );
    if (relevant) {
      void fetchAndRender(pill, recipients);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);

  // Cleanup when compose is removed from the DOM
  const cleanup = new MutationObserver(() => {
    if (!compose.isConnected) {
      window.clearInterval(interval);
      chrome.storage.onChanged.removeListener(storageListener);
      cleanup.disconnect();
      log('content', '[session-status] cleaned up for detached compose');
    }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });
}

/**
 * Force-refreshes the status pill for a compose.
 * Called by inject-toolbar after extracting recipients so the pill can
 * resolve the correct session scope.
 */
export function refreshSessionStatus(
  compose: Element,
  recipients: string[],
): void {
  const pill = compose.querySelector(`[${STATUS_PILL_ATTR}]`);
  if (!pill) return;
  void fetchAndRender(pill, recipients);
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAndRender(pill: Element, recipients: string[]): Promise<void> {
  const state = await querySessionStatus(recipients);
  renderPill(pill, state);
}

function querySessionStatus(recipients: string[]): Promise<SessionStatusState> {
  return new Promise((resolve) => {
    // First check auth
    chrome.runtime.sendMessage(
      { type: 'GET_AUTH_STATUS' },
      (authResponse: { authenticated: boolean } | undefined) => {
        if (chrome.runtime.lastError || !authResponse?.authenticated) {
          resolve({ kind: 'no_auth' });
          return;
        }

        if (recipients.length === 0) {
          resolve({ kind: 'no_session' });
          return;
        }

        // Hash the recipient set — mirrors background/session-store key logic.
        // We compute a stable string key here; the background does the real
        // recipientSetHash computation server-side. For the status display
        // we use the sorted joined string as a lookup key suffix.
        const rsKey = recipients
          .map((e) => e.toLowerCase().trim())
          .sort()
          .join(',');

        chrome.runtime.sendMessage(
          { type: 'GET_SESSION_STATUS', recipientSetHash: rsKey },
          (response: { status: 'active' | 'absent'; expiresAt?: number; email?: string } | undefined) => {
            if (chrome.runtime.lastError || !response) {
              resolve({ kind: 'no_session' });
              return;
            }

            if (response.status === 'absent') {
              resolve({ kind: 'no_session' });
              return;
            }

            const expiresAt = response.expiresAt ?? 0;
            const timeLeft = expiresAt - Date.now();
            const email = response.email ?? '';
            const kind = timeLeft < SESSION_WARNING_MS ? 'expiring' : 'active';
            resolve({ kind, email, expiresAt });
          },
        );
      },
    );
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function buildPill(): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.setAttribute(STATUS_PILL_ATTR, 'true');
  pill.setAttribute('aria-live', 'polite');
  pill.setAttribute('aria-label', 'ProofLine session status');
  pill.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:5px',
    'margin-left:10px',
    'padding:3px 9px',
    'border-radius:10px',
    'font-size:11px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-weight:500',
    'vertical-align:middle',
    'white-space:nowrap',
    'transition:background 0.2s,color 0.2s',
  ].join(';');
  renderPill(pill, { kind: 'no_session' });
  return pill;
}

function renderPill(pill: Element, state: SessionStatusState): void {
  const el = pill as HTMLElement;

  switch (state.kind) {
    case 'no_auth':
      applyStyle(el, '#f3f4f6', '#6b7280', '#e5e7eb');
      el.textContent = '○ Not signed in';
      el.title = 'Sign in to ProofLine to enable signing.';
      break;

    case 'no_session':
      applyStyle(el, '#fef2f2', '#dc2626', '#fecaca');
      el.textContent = '● No active session';
      el.title = 'No ProofLine session active for these recipients. Signing will require biometric.';
      break;

    case 'expiring': {
      const mins = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 60_000));
      const label = formatEmail(state.email);
      applyStyle(el, '#fffbeb', '#d97706', '#fde68a');
      el.textContent = `⚠ Session expiring · ${mins}m left`;
      el.title = `Session active for ${label} — expires in ${mins} minute${mins !== 1 ? 's' : ''}. Next sign may require biometric.`;
      break;
    }

    case 'active': {
      const mins = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 60_000));
      const label = formatEmail(state.email);
      applyStyle(el, '#f0fdf4', '#16a34a', '#bbf7d0');
      el.textContent = `● Session active · ${mins}m left`;
      el.title = `Session active for ${label} — ${mins} minute${mins !== 1 ? 's' : ''} remaining. Next sign will use silent WebAuthn.`;
      break;
    }
  }
}

function applyStyle(
  el: HTMLElement,
  bg: string,
  color: string,
  border: string,
): void {
  el.style.background = bg;
  el.style.color = color;
  el.style.border = `1px solid ${border}`;
}

function formatEmail(email: string): string {
  // "mark@acmetitle.com" → "mark@acmetitle.com" (show first 20 chars)
  return email.length > 22 ? email.slice(0, 20) + '…' : email;
}

/** Exported for tests only. */
export function formatMinutesLeft(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}