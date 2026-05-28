import { sweepInboundMessages } from './inject-badge.js';
import { log, warn } from '../shared/log.js';
import { findComposeContainers } from './gmail-detector.js';
import { tryInject } from './inject-toolbar.js';
import { injectBannerIntoCompose } from './inject-banner.js';
import { isBackgroundToContentMessage } from '../shared/types.js';
import { readComposeId } from './shared.js';

// Content-script entry. Runs once per Gmail tab. We use a single
// MutationObserver on document.body — cheaper than polling and catches
// Gmail's SPA navigation events. Each mutation triggers a sweep that
// walks current compose containers — both floating dialogs AND inline
// reply/forward boxes (PFL-071) — and idempotently injects the button.

// Cached auth flag. The Sign button is only injected when the user is
// connected. chrome.runtime.sendMessage is async, so we cannot query it
// inside the synchronous sweep — instead we cache the result and refresh
// it on a timer + on the AUTH_LOGOUT broadcast.
let isAuthenticated = false;
const AUTH_REFRESH_MS = 30_000;

function refreshAuthStatus(): void {
  try {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        // SW asleep / not reachable — leave the flag as-is.
        return;
      }
      const next = Boolean(response && (response as { authenticated?: boolean }).authenticated);
      if (next !== isAuthenticated) {
        isAuthenticated = next;
        // Auth state changed — run a sweep so the button appears/clears
        // without waiting for the next Gmail DOM mutation.
        sweep();
      }
    });
  } catch {
    // sendMessage can throw if the extension context is invalidated
    // (e.g. during reload). Non-fatal.
  }
}

function sweep(): void {
  if (isAuthenticated) {
    const composes = findComposeContainers(document);
    for (const compose of composes) {
      tryInject(compose);
    }
  }
  sweepInboundMessages(document);
}

function findComposeByComposeId(composeId: string): Element | null {
  const composes = findComposeContainers(document);
  for (const compose of composes) {
    if (readComposeId(compose) === composeId) return compose;
  }
  // Fallback — synthetic ids used when Gmail hasn't assigned a draft id
  // yet; just take the first open compose. We expect at most one in the
  // common case (Sarah clicking Sign on the container she just opened).
  return composes.length === 1 ? composes[0]! : null;
}

function listenForBackgroundMessages(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundToContentMessage(message)) {
      return false;
    }
    if (message.type === 'PAYLOAD_SIGNED') {
      const compose = findComposeByComposeId(message.composeId);
      if (!compose) {
        warn('content', 'PAYLOAD_SIGNED: no matching compose', message.composeId);
        sendResponse({ ok: false, reason: 'COMPOSE_NOT_FOUND' });
        return false;
      }
      const result = injectBannerIntoCompose(compose, message.bannerHtml);
      log('content', 'banner injected', result);
      sendResponse({ ok: result.ok });
      return false;
    }
    if (message.type === 'SIGN_FAILED') {
      warn('content', 'sign failed', message.code, message.message);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAYLOAD_NEEDS_COSIGN') {
      log('content', 'cosign required', message.approvers);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'AUTH_LOGIN') {
      isAuthenticated = true;
      // Inject into any compose windows already open at sign-in time,
      // without waiting for the next Gmail DOM mutation or re-check.
      sweep();
      log('content', 'auth login broadcast — Sign buttons injected');
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'AUTH_LOGOUT') {
      isAuthenticated = false;
      // Buttons injected before logout would otherwise linger until the
      // next page refresh — gating sweep() only prevents NEW injections.
      // Remove any already-injected Sign buttons now.
      document
        .querySelectorAll('[data-proofline-injected="true"]')
        .forEach((el) => el.remove());
      log('content', 'auth logout broadcast — Sign buttons removed');
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}

function start(): void {
  log('content', 'ProofLine content script loaded');

  listenForBackgroundMessages();

  // Resolve auth status, then sweep (refreshAuthStatus runs sweep() itself
  // when the flag flips). Also run an initial sweep for inbound-message
  // badges, which don't depend on auth.
  refreshAuthStatus();
  sweep();

  // Periodically re-check auth so a login/logout in another surface
  // propagates even if the AUTH_LOGOUT broadcast was missed (SW asleep).
  setInterval(refreshAuthStatus, AUTH_REFRESH_MS);

  const observer = new MutationObserver(() => {
    sweep();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
