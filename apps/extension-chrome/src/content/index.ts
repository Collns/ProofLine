import { log } from '../shared/log.js';
import { findComposeDialogs } from './gmail-detector.js';
import { tryInject } from './inject-toolbar.js';

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

function start(): void {
  log('content', 'ProofLine content script loaded');

  // Run once on load — Gmail may already have a compose open
  // (e.g., after extension reload).
  sweep();

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
