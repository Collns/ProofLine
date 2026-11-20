import { log, warn } from '../shared/log.js';
import type {
  ContentToBackgroundMessage,
  BackgroundResponse,
} from '../shared/types.js';
import {
  INJECTED_MARKER,
  TOOLBAR_NOT_FOUND_MARKER,
  alreadyInjected,
  ensureComposeId,
} from './shared.js';
import { findToolbarWithSelector } from './gmail-detector.js';
import { buildSignPayload } from './sign-payload.js';
import { mountWireFields } from './wire-fields.js';
import { canonicalizeAndHash } from './canonical-bridge.js';
import { clearComposeGuardState, beginSigning, endSigning, setSignState, clearSendAlert, getUnsignedPolicy } from './send-guard.js';

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
  position: 'relative',
  zIndex: '2147483647',
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
  // Route every background round-trip through the stable per-instance id we
  // stamped at injection (PFL-181). Gmail's own draft id is often absent in
  // inline reply / forward composes, which is why PAYLOAD_SIGNED replies
  // could fail to find the compose and the banner / signed state never
  // landed. The stamped id is always present once the Sign button exists.
  const correlationId = ensureComposeId(compose);

  // Fresh attempt: drop any stale block/fail alert from a prior click so a
  // validation failure can't leave an old "still signing" message on screen.
  clearSendAlert(compose);

  // Keep SIGN_BUTTON_CLICKED for backwards compatibility with PFL-042.
  // PFL-044 will collapse this once the live ceremony lands.
  sendToBackground({
    type: 'SIGN_BUTTON_CLICKED',
    composeId: correlationId,
  });

  // Validate BEFORE marking the compose pending (PFL-181 #3): a wire with
  // invalid fields or an unreadable DOM must not look like it is "signing".
  const result = buildSignPayload(compose);
  if (!result.ok && result.reason === 'wire_invalid') {
    warn('content', 'wire fields invalid — sign blocked');
    showWireNotice(compose);
    return;
  }
  if (!result.ok) {
    warn('content', 'payload extraction failed', result.extraction.error.code);
    sendToBackground({
      type: 'EXTRACTION_FAILED',
      composeId: correlationId,
      error: result.extraction.error,
    });
    return;
  }
  clearWireNotice(compose);

  // Payload is valid — now the compose is genuinely signing. Show progress and
  // arm the timeout so a lost popup result can't hang on "still signing".
  beginSigning(compose);

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
    endSigning(compose);
    setSignState(compose, 'failed');
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

const WIRE_NOTICE_ATTR = 'data-proofline-wire-notice';

function showWireNotice(compose: Element): void {
  if (compose.querySelector(`[${WIRE_NOTICE_ATTR}]`)) return;
  const panel = compose.querySelector('[data-proofline-wire-panel]');
  const notice = document.createElement('div');
  notice.setAttribute(WIRE_NOTICE_ATTR, 'true');
  notice.setAttribute('role', 'alert');
  notice.textContent = 'Fix the highlighted wire fields before signing.';
  notice.style.cssText = 'color:#D93025;font-size:12px;margin-top:4px;';
  (panel ?? compose).appendChild(notice);
}

function clearWireNotice(compose: Element): void {
  compose.querySelector(`[${WIRE_NOTICE_ATTR}]`)?.remove();
}

function injectInto(compose: Element): boolean {
  if (alreadyInjected(compose)) return false;

  const match = findToolbarWithSelector(compose);
  if (!match) return false;

  // Stamp the stable per-instance id and clear any guard state left over
  // from a previous extension session on this element (PFL-181).
  ensureComposeId(compose);
  clearComposeGuardState(compose);

  const button = buildButton(compose);
  match.toolbar.appendChild(button);
  // PFL-135: "Wire instruction" toggle + fields next to the Sign button.
  mountWireFields(compose, match.toolbar);
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

// ─── PFL-188: subtle company-policy chip in the compose ───────────────────────

const POLICY_CHIP_ATTR = 'data-proofline-policy-chip';

/** Idempotently reflects the active unsigned-email policy in the compose.
 *  Shown for block/warn (and when the policy couldn't be fetched); hidden for
 *  allow. Safe to call on every sweep: it performs NO DOM mutation when the
 *  chip is already in the desired state — critical, because the content
 *  script's MutationObserver re-runs the sweep on any DOM change, so a chip
 *  that rewrote itself every sweep would loop forever and freeze Gmail
 *  (PFL-188). */
export function updatePolicyChip(compose: Element): void {
  const policy = getUnsignedPolicy();
  const existing = compose.querySelector<HTMLElement>(`[${POLICY_CHIP_ATTR}]`);

  let message: string | null = null;
  if (policy.failed) message = "Company policy: signing required (couldn't reach ProofLine)";
  else if (policy.mode === 'block') message = 'Company policy: signing required';
  else if (policy.mode === 'warn') message = 'Company policy: signing recommended';

  // No-op fast paths — never touch the DOM when nothing would change.
  if (!message) {
    if (existing) existing.remove();
    return;
  }
  if (existing && existing.textContent === message) return;

  const chip = existing ?? document.createElement('div');
  if (!existing) {
    chip.setAttribute(POLICY_CHIP_ATTR, 'true');
    chip.style.cssText = [
      'display:inline-block', 'margin-left:10px', 'vertical-align:middle',
      'color:#6b7280', 'font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');
    const signBtn = compose.querySelector<HTMLElement>(`[${INJECTED_MARKER}="true"]`);
    (signBtn?.parentElement ?? compose).appendChild(chip);
  }
  chip.textContent = message;
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
