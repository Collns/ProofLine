import { log, warn } from '../shared/log.js';

interface AuthStatusResponse {
  ok?: boolean;
  authenticated?: boolean;
  email?: string;
  companyId?: string;
  userId?: string;
  loggedOut?: boolean;
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function sendMessage(message: { type: string }): Promise<AuthStatusResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          warn('popup', 'sendMessage error', chrome.runtime.lastError.message);
          resolve({ ok: false });
          return;
        }
        resolve((response as AuthStatusResponse) ?? { ok: false });
      });
    } catch (err) {
      warn('popup', 'sendMessage threw', err);
      resolve({ ok: false });
    }
  });
}

function renderConnected(email: string): void {
  setText('status', `Connected as ${email}`);
  const status = document.getElementById('status');
  if (status) status.style.borderLeftColor = '#0F9D58';

  const btn = document.getElementById('connect') as HTMLButtonElement | null;
  if (!btn) return;
  btn.textContent = 'Sign out';
  // Red outline style for the sign-out action.
  btn.style.background = '#FFFFFF';
  btn.style.color = '#DC2626';
  btn.style.border = '1px solid #DC2626';
  btn.dataset['mode'] = 'signout';
}

function renderDisconnected(): void {
  setText('status', 'Not connected');
  const status = document.getElementById('status');
  if (status) status.style.borderLeftColor = '#9CA3AF';

  const btn = document.getElementById('connect') as HTMLButtonElement | null;
  if (!btn) return;
  btn.textContent = 'Connect to ProofLine';
  // Restore primary-blue style (matches popup.html .connect defaults).
  btn.style.background = '#0D6EFD';
  btn.style.color = '#FFFFFF';
  btn.style.border = 'none';
  btn.dataset['mode'] = 'connect';
}

function applyStatus(response: AuthStatusResponse): void {
  if (response.authenticated && response.email) {
    renderConnected(response.email);
  } else if (response.authenticated) {
    // Authenticated but email missing — still show connected generically.
    renderConnected('your ProofLine account');
  } else {
    renderDisconnected();
  }
}

async function onConnectClick(): Promise<void> {
  const btn = document.getElementById('connect') as HTMLButtonElement | null;
  const mode = btn?.dataset['mode'] ?? 'connect';

  if (mode === 'signout') {
    log('popup', 'sign out clicked');
    setText('status', 'Signing out…');
    const res = await sendMessage({ type: 'SIGN_OUT' });
    log('popup', 'sign out result', res);
    renderDisconnected();
    return;
  }

  log('popup', 'connect clicked');
  setText('status', 'Connecting…');
  const res = await sendMessage({ type: 'REQUEST_AUTH' });
  log('popup', 'connect result', res);
  applyStatus(res);
}

async function init(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  setText('version', manifest.version ?? '0.0.0');

  const connect = document.getElementById('connect');
  if (connect) {
    connect.addEventListener('click', () => {
      void onConnectClick();
    });
  }

  const status = await sendMessage({ type: 'GET_AUTH_STATUS' });
  applyStatus(status);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
} else {
  void init();
}
