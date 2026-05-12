// Delivery layer for the popup → extension result.
//
// The shipped extension contract (apps/extension-chrome/src/shared/
// ceremony.types.ts) uses chrome.runtime.sendMessage(extInstallId, ...)
// as the primary delivery mechanism — preferred over postMessage in
// MV3 because the extension declares externally_connectable for this
// origin. We keep window.opener.postMessage as a typed fallback for
// non-extension contexts (Playwright harness, dev iframe testing).
//
// The CeremonyResponse shape MUST match the extension's typed contract
// EXACTLY — that file is the source of truth, this file is a consumer.

import type { SignedEnvelope } from '@proofline/types';

// Mirrors apps/extension-chrome/src/shared/ceremony.types.ts.
// Kept as a copy here rather than imported because the extension package
// isn't part of this app's workspace deps (it's an external launcher).
// Both sides MUST agree — any drift is a runtime contract bug.
export type CeremonyResponse =
  | {
      kind: 'auth_success';
      ceremonyId: string;
      authToken: string;
      userId: string;
      companyId: string;
      email: string;
    }
  | {
      kind: 'sign_success';
      ceremonyId: string;
      envelope: SignedEnvelope;
      banner: string;
      sessionToken?: string;
    }
  | {
      kind: 'verify_success';
      ceremonyId: string;
      result: unknown;
    }
  | { kind: 'user_cancelled'; ceremonyId: string }
  | { kind: 'error'; ceremonyId: string; code: string; message: string };

export interface DeliveryOptions {
  extInstallId: string;
  returnOrigin: string; // chrome-extension://<id>
}

export interface DeliveryResult {
  via: 'chrome.runtime' | 'window.opener' | 'none';
  delivered: boolean;
  reason?: string;
}

// Minimal structural type for chrome.runtime.sendMessage so we don't
// need @types/chrome. We only call sendMessage with (extId, message,
// callback) — that's the entire surface this file uses.
interface ChromeRuntimeShape {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

interface ChromeShape {
  runtime?: ChromeRuntimeShape;
}

function getChromeRuntime(): ChromeRuntimeShape | null {
  const c = (globalThis as unknown as { chrome?: ChromeShape }).chrome;
  return c?.runtime ?? null;
}

/**
 * Deliver a CeremonyResponse to the extension launcher.
 *
 * Order of attempts:
 *   1. chrome.runtime.sendMessage(extInstallId, response) — production path.
 *   2. window.opener.postMessage(response, returnOrigin) — fallback. ALWAYS
 *      uses an explicit targetOrigin (chrome-extension://<id>); never '*'.
 */
export async function deliverToOpener(
  response: CeremonyResponse,
  opts: DeliveryOptions,
): Promise<DeliveryResult> {
  const runtime = getChromeRuntime();
  if (runtime) {
    const result = await tryChromeRuntime(runtime, response, opts.extInstallId);
    if (result.delivered) return result;
  }

  // Fallback: window.opener.postMessage with an explicit chrome-extension://
  // targetOrigin. The browser will silently drop the message if the opener's
  // actual origin doesn't match.
  if (typeof window === 'undefined' || !window.opener) {
    return {
      via: 'none',
      delivered: false,
      reason: 'no chrome.runtime and window.opener is null',
    };
  }
  try {
    (window.opener as Window).postMessage(response, opts.returnOrigin);
    return { via: 'window.opener', delivered: true };
  } catch (e) {
    return {
      via: 'window.opener',
      delivered: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

function tryChromeRuntime(
  runtime: ChromeRuntimeShape,
  response: CeremonyResponse,
  extId: string,
): Promise<DeliveryResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (delivered: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      resolve({ via: 'chrome.runtime', delivered, reason });
    };
    try {
      runtime.sendMessage(extId, response, () => {
        const errMsg = runtime.lastError?.message;
        if (errMsg) finish(false, errMsg);
        else finish(true);
      });
      // Chrome MV3 rarely fails the sendMessage synchronously. Time-box
      // the wait so a stuck callback doesn't hang the popup.
      setTimeout(() => finish(true), 250);
    } catch (e) {
      finish(false, e instanceof Error ? e.message : String(e));
    }
  });
}
