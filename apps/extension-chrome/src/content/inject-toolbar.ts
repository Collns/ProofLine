import { log, warn } from '../shared/log.js';
import type {
  ContentToBackgroundMessage,
  BackgroundResponse,
} from '../shared/types.js';
import {
  INJECTED_MARKER,
  TOOLBAR_NOT_FOUND_MARKER,
  alreadyInjected,
  readComposeId,
} from './shared.js';
import { findToolbarWithSelector } from './gmail-detector.js';
import { extractPayload } from './extract-payload.js';
import { canonicalizeAndHash } from './canonical-bridge.js';

const BUTTON_LABEL = 'Sign with ProofLine';
const FALLBACK_TIMEOUT_MS = 3000;

// PRD §8.2 — brand blue. Inline so Gmail's stylesheet can't override us.
const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: '#0D6EFD',
  color: '#FFFFFF',
  border: 'none',
  padding: '6px 12px',
  borderRadius: '4px',
  font: 'inherit',
  cursor: 'pointer',
  marginLeft: '8px',
};

function buildButton(compose: Element): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = BUTTON_LABEL;
  btn.setAttribute(INJECTED_MARKER, 'true');
  for (const [k, v] of Object.entries(BUTTON_STYLE)) {
    (btn.style as unknown as Record<string, string>)[k] = v as string;
  }
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onClick(compose);
  });
  return btn;
}

function sendToBackground(message: ContentToBackgroundMessage): void {
  try {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse) => {
      if (chrome.runtime.lastError) {
        warn('content', 'SW error', chrome.runtime.lastError.message);
        return;
      }
      log('content', 'SW ack', response);
    });
  } catch (err) {
    warn('content', 'sendMessage threw', err);
  }
}

async function onClick(compose: Element): Promise<void> {
  // SIGN_BUTTON_CLICKED's composeId may be null (compose with no draft id
  // yet). Extraction messages carry a non-null id, so synthesize one for
  // routing if Gmail hasn't given us a draft id.
  const detectedId = readComposeId(compose);
  const correlationId =
    detectedId ?? `synthetic-${crypto.randomUUID()}`;

  // Keep SIGN_BUTTON_CLICKED for backwards compatibility with PFL-042.
  // PFL-044 will collapse this once the live ceremony lands.
  sendToBackground({
    type: 'SIGN_BUTTON_CLICKED',
    composeId: detectedId,
  });

  const result = extractPayload(compose);
  if (!result.ok) {
    warn('content', 'payload extraction failed', result.error.code);
    sendToBackground({
      type: 'EXTRACTION_FAILED',
      composeId: correlationId,
      error: result.error,
    });
    return;
  }

  try {
    const { payloadHashHex } = await canonicalizeAndHash(result.payload);
    log('content', 'payload extracted', {
      composeId: correlationId,
      payloadHashHex,
      to: result.payload.to,
    });
    sendToBackground({
      type: 'PAYLOAD_EXTRACTED',
      composeId: correlationId,
      canonicalHashHex: payloadHashHex,
      partialPayload: result.payload,
    });
  } catch (err) {
    warn('content', 'canonicalize/hash threw', err);
    sendToBackground({
      type: 'EXTRACTION_FAILED',
      composeId: correlationId,
      error: {
        code: 'DOM_UNEXPECTED',
        reason: `canonicalize/hash threw: ${String(err)}`,
        domSnapshot: '',
      },
    });
  }
}

function injectInto(compose: Element): boolean {
  if (alreadyInjected(compose)) return false;

  const match = findToolbarWithSelector(compose);
  if (!match) return false;

  const button = buildButton(compose);
  match.toolbar.appendChild(button);
  log('content', 'injected button via selector', match.selector);
  return true;
}

function scheduleFallback(compose: Element): void {
  // If after FALLBACK_TIMEOUT_MS no selector has matched, mark the
  // dialog and surface a non-blocking notice. F-EXT-09 — never silent.
  const handle = window.setTimeout(() => {
    if (alreadyInjected(compose)) return;
    if (!compose.isConnected) return;
    if (findToolbarWithSelector(compose)) return;

    compose.setAttribute(TOOLBAR_NOT_FOUND_MARKER, 'true');
    warn('content', 'toolbar not found after', FALLBACK_TIMEOUT_MS, 'ms');
    showNotice(compose);
  }, FALLBACK_TIMEOUT_MS);

  // Guard: if the compose is removed before the fallback fires, drop the timer.
  const cleanup = new MutationObserver(() => {
    if (!compose.isConnected) {
      window.clearTimeout(handle);
      cleanup.disconnect();
    }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });
}

function showNotice(compose: Element): void {
  const notice = document.createElement('div');
  notice.setAttribute('data-proofline-notice', 'true');
  notice.textContent = 'ProofLine extension needs an update';
  Object.assign(notice.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: '#FEF2F2',
    color: '#7F1D1D',
    border: '1px solid #FCA5A5',
    borderRadius: '4px',
    padding: '6px 10px',
    fontSize: '12px',
    fontFamily: 'inherit',
    zIndex: '999999',
  } satisfies Partial<CSSStyleDeclaration>);
  compose.appendChild(notice);
}

// Public entry — idempotent. Returns true if a button was newly injected
// on this call; false otherwise (already injected, no toolbar yet, etc).
export function tryInject(compose: Element): boolean {
  if (alreadyInjected(compose)) return false;
  const injected = injectInto(compose);
  if (!injected) {
    scheduleFallback(compose);
  }
  return injected;
}
