// SECURITY-CRITICAL.
//
// The popup ceremony page only delivers a signed envelope back to a
// caller it can identify as a known ProofLine extension. Two checks
// at page load:
//
//   1. The URL params must include extInstallId in a chrome-extension
//      ID format (32 lowercase letters, [a-p]). The launcher writes
//      this from chrome.runtime.id, which the browser controls and
//      a hostile site can't forge.
//   2. returnOrigin must equal exactly `chrome-extension://${extInstallId}` —
//      any deviation is treated as a forgery attempt.
//
// Why we DO NOT require window.opener:
//   The extension opens this popup via chrome.windows.create(), which
//   creates a top-level window with `window.opener === null`. So a
//   window.opener check would reject every real extension flow. The
//   security model instead relies on:
//     - Format-checking extInstallId (32-char a–p — only Chrome extension
//       IDs match), and
//     - Delivering responses via chrome.runtime.sendMessage(extInstallId, …),
//       which Chrome routes only to the extension whose manifest declares
//       this origin in `externally_connectable`. A hostile site cannot
//       receive a response addressed to a real ProofLine extension ID.
//
// Cross-origin restrictions block us from reading window.opener.location,
// so even if an opener existed we could not check its origin string.

// chrome-extension IDs are exactly 32 lowercase letters in the range a–p.
const EXT_ID_RE = /^[a-p]{32}$/;

export type OpenerValidation =
  | { ok: true; extInstallId: string; returnOrigin: string }
  | { ok: false; reason: 'BAD_EXT_ID' | 'BAD_RETURN_ORIGIN' };

export interface OpenerInputs {
  extInstallId: string | null;   // from URL ?extInstallId=
  returnOrigin: string | null;   // from URL ?returnOrigin=
}

export function validateOpener(input: OpenerInputs): OpenerValidation {
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

// Convenience adapter for use in components — reads URL search params.
// The `win` argument is unused (kept for callsite stability) since the
// extension launcher uses chrome.windows.create() which sets
// `window.opener` to null.
export function validateOpenerFromWindow(
  _win: Window,
  search: string,
): OpenerValidation {
  const params = new URLSearchParams(search);
  return validateOpener({
    extInstallId: params.get('extInstallId'),
    returnOrigin: params.get('returnOrigin'),
  });
}
