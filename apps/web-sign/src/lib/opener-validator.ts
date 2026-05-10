// SECURITY-CRITICAL.
//
// The popup ceremony page only delivers a signed envelope back to a
// caller it can identify as a known ProofLine extension. Two checks
// at page load:
//
//   1. window.opener must exist (the page was opened by a launcher,
//      not surfed to directly).
//   2. The URL params must include extInstallId in a chrome-extension
//      ID format (32 lowercase letters, [a-p]). The launcher writes
//      this from chrome.runtime.id, which the browser controls and
//      a hostile site can't forge.
//
// Cross-origin restrictions block us from reading window.opener.location,
// so we cannot check the opener's origin string directly. Instead we
// trust the chrome-extension ID format check + delivery mechanism
// (chrome.runtime.sendMessage with the same id) to bind the response
// to the launcher.

// chrome-extension IDs are exactly 32 lowercase letters in the range a–p.
const EXT_ID_RE = /^[a-p]{32}$/;

export type OpenerValidation =
  | { ok: true; extInstallId: string; returnOrigin: string }
  | { ok: false; reason: 'NO_OPENER' | 'BAD_EXT_ID' | 'BAD_RETURN_ORIGIN' };

export interface OpenerInputs {
  hasOpener: boolean;            // typically window.opener != null
  extInstallId: string | null;   // from URL ?extInstallId=
  returnOrigin: string | null;   // from URL ?returnOrigin=
}

export function validateOpener(input: OpenerInputs): OpenerValidation {
  if (!input.hasOpener) {
    return { ok: false, reason: 'NO_OPENER' };
  }
  if (!input.extInstallId || !EXT_ID_RE.test(input.extInstallId)) {
    return { ok: false, reason: 'BAD_EXT_ID' };
  }
  // returnOrigin must be exactly chrome-extension://<extInstallId> with no
  // trailing path or hash. Any deviation is a forgery attempt.
  const expected = `chrome-extension://${input.extInstallId}`;
  if (!input.returnOrigin || input.returnOrigin !== expected) {
    return { ok: false, reason: 'BAD_RETURN_ORIGIN' };
  }
  return { ok: true, extInstallId: input.extInstallId, returnOrigin: input.returnOrigin };
}

// Convenience adapter for use in components — reads window + URL search params.
export function validateOpenerFromWindow(
  win: Window,
  search: string,
): OpenerValidation {
  const params = new URLSearchParams(search);
  return validateOpener({
    hasOpener: win.opener != null,
    extInstallId: params.get('extInstallId'),
    returnOrigin: params.get('returnOrigin'),
  });
}
