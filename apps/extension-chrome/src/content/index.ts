import { log, warn } from '../shared/log.js';
import { findComposeDialogs } from './gmail-detector.js';
import { tryInject } from './inject-toolbar.js';
import { injectBannerIntoCompose } from './inject-banner.js';
import { isBackgroundToContentMessage } from '../shared/types.js';
import { readComposeId } from './shared.js';

// Content-script entry. Runs once per Gmail tab. We use a single
// MutationObserver on document.body — cheaper than polling and catches
// Gmail's SPA navigation events. Each mutation triggers a sweep that
// walks current compose dialogs and idempotently injects the button.

function sweep(): void {
  const dialogs = findComposeDialogs(document);
  for (const compose of dialogs) {
    tryInject(compose);
  }
}

function findComposeByComposeId(composeId: string): Element | null {
  for (const compose of findComposeDialogs(document)) {
    if (readComposeId(compose) === composeId) return compose;
  }
  // Fallback — synthetic ids used when Gmail hasn't assigned a draft id
  // yet; just take the first open compose. We expect at most one in the
  // common case (Sarah clicking Sign on the dialog she just opened).
  const dialogs = findComposeDialogs(document);
  return dialogs.length === 1 ? dialogs[0]! : null;
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
    return false;
  });
}

function start(): void {
  log('content', 'ProofLine content script loaded');

  // Run once on load — Gmail may already have a compose open
  // (e.g., after extension reload).
  sweep();

  listenForBackgroundMessages();

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
