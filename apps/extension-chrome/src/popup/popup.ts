import { log } from '../shared/log.js';

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function init(): void {
  const manifest = chrome.runtime.getManifest();
  setText('version', manifest.version ?? '0.0.0');

  const connect = document.getElementById('connect');
  if (connect) {
    connect.addEventListener('click', () => {
      log('popup', 'connect clicked (stub)');
      window.alert('Connect coming soon — full WebAuthn flow lands in PFL-053.');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
