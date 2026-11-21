import { log, warn } from '../shared/log.js';

interface RecentActivityEntry {
  composeType: string;
  footerAdded: boolean;
  overrode: boolean;
  at: number;
}

interface AuthStatusResponse {
  ok?: boolean;
  authenticated?: boolean;
  email?: string;
  companyId?: string;
  userId?: string;
  loggedOut?: boolean;
  activity?: RecentActivityEntry[];
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

const COMPOSE_LABELS: Record<string, string> = {
  new_compose: 'New email',
  inline_reply: 'Reply',
  inline_forward: 'Forward',
  popout_reply: 'Reply',
  popout_forward: 'Forward',
};

function relativeTime(at: number): string {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderActivity(entries: RecentActivityEntry[]): void {
  const section = document.getElementById('activity');
  const list = document.getElementById('activity-list');
  if (!section || !list) return;
  if (!entries.length) {
    section.setAttribute('hidden', 'true');
    return;
  }
  section.removeAttribute('hidden');
  list.textContent = '';
  for (const e of entries) {
    const li = document.createElement('li');
    const what = COMPOSE_LABELS[e.composeType] ?? 'Email';
    const footer = e.footerAdded ? ' · footer added' : '';
    const label = document.createElement('span');
    label.textContent = `${what} sent unsigned${footer}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ` — ${relativeTime(e.at)}`;
    li.appendChild(label);
    li.appendChild(meta);
    list.appendChild(li);
  }
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

  const recent = await sendMessage({ type: 'GET_RECENT_ACTIVITY' });
  renderActivity(recent.activity ?? []);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
} else {
  void init();
}
