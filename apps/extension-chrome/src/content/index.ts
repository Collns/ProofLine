import { sweepInboundMessages } from './inject-badge.js';
import { log, warn } from '../shared/log.js';
import { findComposeContainers } from './gmail-detector.js';
import { tryInject, updatePolicyChip } from './inject-toolbar.js';
import { injectBannerIntoCompose } from './inject-banner.js';
import { isBackgroundToContentMessage } from '../shared/types.js';
import { readComposeId, COMPOSE_ID_ATTR } from './shared.js';
import { installSendGuard, setSignState, markSigned, endSigning, setUnsignedPolicy, getUnsignedPolicy } from './send-guard.js';
import { watchCosign, COSIGN_ENVELOPE_ATTR, type CosignStatusReply } from './cosign-release.js';
import { composeType } from './compose-type.js';
import { canonicalizeAndHash } from './canonical-bridge.js';
import { buildSignPayload } from './sign-payload.js';
import { showUnsignedSentNotice } from './sent-notice.js';

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

// ─── PFL-188: company unsigned-email policy (fetch, cache, fail closed) ───────
const POLICY_REFRESH_MS = 60_000;
const POLICY_MIN_INTERVAL_MS = 10_000;
let lastPolicyFetch = 0;

/** Fail closed: block, no override. */
function failClosedPolicy(): void {
  setUnsignedPolicy({ mode: 'block', allowOverride: false, failed: true, appendFooter: true });
}

function refreshPolicy(force = false): void {
  const nowMs = Date.now();
  if (!force && nowMs - lastPolicyFetch < POLICY_MIN_INTERVAL_MS) return;
  lastPolicyFetch = nowMs;
  try {
    chrome.runtime.sendMessage({ type: 'GET_POLICY' }, (response) => {
      if (chrome.runtime.lastError) { failClosedPolicy(); return; }
      const r = response as { policyFailed?: boolean; policy?: { mode?: string; allowUnsignedOverride?: boolean; appendUnsignedFooter?: boolean } } | undefined;
      if (!r || r.policyFailed || !r.policy || !r.policy.mode) {
        failClosedPolicy();
      } else {
        const mode = (r.policy.mode === 'warn' || r.policy.mode === 'allow') ? r.policy.mode : 'block';
        setUnsignedPolicy({
          mode,
          allowOverride: r.policy.allowUnsignedOverride === true,
          // PFL-190: footer defaults ON unless the company explicitly turned it off.
          appendFooter: r.policy.appendUnsignedFooter !== false,
          failed: false,
        });
      }
      scheduleSweep(); // reflect the (possibly changed) policy in open composes
    });
  } catch {
    failClosedPolicy();
  }
}

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
    let injected = false;
    for (const compose of composes) {
      if (tryInject(compose)) injected = true;
    }
    // PFL-188: reflect the current policy in every open compose. These calls
    // are idempotent — no DOM mutation when the chip is already correct — so
    // the MutationObserver below can't feed itself into a loop.
    for (const compose of composes) updatePolicyChip(compose);
    // Refresh the policy when a compose newly opens (throttled to 10s).
    if (injected) refreshPolicy();
  }
  sweepInboundMessages(document);
}

// PFL-188: coalesce MutationObserver bursts (Gmail fires many mutations as a
// compose opens, and our own injections fire more) into a single sweep on the
// next macrotask, and never run two sweeps concurrently. Combined with the
// idempotent injections above, this stops the observer→mutate→observe loop
// that froze the Gmail renderer.
let sweepScheduled = false;
function scheduleSweep(): void {
  if (sweepScheduled) return;
  sweepScheduled = true;
  setTimeout(() => { sweepScheduled = false; sweep(); }, 0);
}

/**
 * PFL-188/190: report an unsigned send to the background — it records recent
 * activity (shown in the popup) and, for an explicit override, audits it
 * (user, company, recipient-set hash, compose type, policy, footerAdded).
 * Best-effort; never blocks the send.
 */
function reportUnsignedSend(compose: Element, info: { overrode: boolean; footerAdded: boolean }): void {
  const policy = getUnsignedPolicy();
  const type = composeType(compose);
  const send = (recipientSetHash: string) => {
    try {
      chrome.runtime.sendMessage({
        type: 'UNSIGNED_SENT',
        overrode: info.overrode,
        footerAdded: info.footerAdded,
        composeType: type,
        policyMode: policy.failed ? 'block_failclosed' : policy.mode,
        recipientSetHash,
      });
    } catch { /* best-effort */ }
  };
  // Best-effort recipient-set hash from the current recipients. The footer we
  // just appended lives in the body, not the recipients, so the hash is stable.
  const built = buildSignPayload(compose);
  if (!built.ok) { send(''); return; }
  const p = built.payload;
  canonicalizeAndHash({ to: p.to, cc: p.cc ?? [], bcc: p.bcc ?? [] })
    .then((r) => send(r.payloadHashHex))
    .catch(() => send(''));
}

function findComposeByComposeId(composeId: string): Element | null {
  // Primary: the stable id we stamped at injection and sent to the
  // background (PFL-181) — reliable for inline reply / forward composes.
  const byStamp = document.querySelector(`[${COMPOSE_ID_ATTR}="${CSS.escape(composeId)}"]`);
  if (byStamp) return byStamp;

  const composes = findComposeContainers(document);
  for (const compose of composes) {
    if (readComposeId(compose) === composeId) return compose;
  }
  // Last-ditch — a single open compose is unambiguous.
  return composes.length === 1 ? composes[0]! : null;
}

const cosignWatchDeps = {
  checkStatus: (envelopeId: string) =>
    new Promise<CosignStatusReply | null>((resolve) => {
      chrome.runtime.sendMessage({ type: 'COSIGN_STATUS', envelopeId }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          resolve(null);
          return;
        }
        resolve({ status: response.status, bannerHtml: response.bannerHtml });
      });
    }),
  injectBanner: (compose: Element, html: string) => injectBannerIntoCompose(compose, html),
  markSigned: (compose: Element) => {
    markSigned(compose);
    log('content', 'cosign approved; send released');
  },
  isAttached: (compose: Element) => compose.isConnected,
  schedule: (fn: () => void, ms: number) => setTimeout(fn, ms),
  now: () => Date.now(),
};

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
      compose.removeAttribute(COSIGN_ENVELOPE_ATTR);
      endSigning(compose); // result is back: cancel the signing timeout + progress
      const result = injectBannerIntoCompose(compose, message.bannerHtml);
      log('content', 'banner injected', result);
      // PFL-096: only a message that carries the banner counts as signed.
      // PFL-181: markSigned also records the content fingerprint so a later
      // edit (or a recycled container) re-locks Send.
      if (result.ok) markSigned(compose);
      else setSignState(compose, 'failed');
      sendResponse({ ok: result.ok });
      return false;
    }
    if (message.type === 'SIGN_FAILED') {
      // A new attempt on this compose failed; stop watching any earlier envelope.
      findComposeByComposeId(message.composeId)?.removeAttribute(COSIGN_ENVELOPE_ATTR);
      warn('content', 'sign failed', message.code, message.message);
      const compose = findComposeByComposeId(message.composeId);
      if (compose) { endSigning(compose); setSignState(compose, 'failed'); }
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAYLOAD_NEEDS_COSIGN') {
      log('content', 'cosign required', message.approvers);
      const compose = findComposeByComposeId(message.composeId);
      if (compose) {
        endSigning(compose); // result is back: cancel the signing timeout + progress
        setSignState(compose, 'cosign_pending');
        // PFL-136: release the send automatically once a cosigner approves.
        if (message.envelopeId) watchCosign(compose, message.envelopeId, cosignWatchDeps);
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'AUTH_LOGIN') {
      isAuthenticated = true;
      refreshPolicy(true); // PFL-188: pull the company policy right after connecting
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

  // PFL-096: block Gmail Send while signing is pending, failed, waiting on a
  // cosigner, or for an unsigned wire instruction.
  installSendGuard(document, {
    findComposes: findComposeContainers,
    onSendUnsigned: (compose) => {
      warn('content', 'send unsigned chosen', readComposeId(compose));
    },
    onUnsignedSend: (compose, info) => {
      // PFL-190: sender-facing notice near Gmail's "Message sent" toast.
      showUnsignedSentNotice();
      // PFL-188/190: record the send (recent activity + override audit).
      reportUnsignedSend(compose, info);
    },
  });

  // Resolve auth status, then sweep (refreshAuthStatus runs sweep() itself
  // when the flag flips). Also run an initial sweep for inbound-message
  // badges, which don't depend on auth.
  refreshAuthStatus();
  refreshPolicy(true); // PFL-188: fetch the company policy up front (fails closed)
  sweep();

  // Periodically re-check auth so a login/logout in another surface
  // propagates even if the AUTH_LOGOUT broadcast was missed (SW asleep).
  setInterval(refreshAuthStatus, AUTH_REFRESH_MS);
  // PFL-188: refresh the policy on a short interval too.
  setInterval(() => refreshPolicy(true), POLICY_REFRESH_MS);

  // Debounced: a mutation (including our own injections) schedules one sweep
  // on the next macrotask rather than running synchronously per mutation.
  const observer = new MutationObserver(() => {
    scheduleSweep();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
