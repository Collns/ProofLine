// Wraps @proofline/webauthn for the browser-side assertion ceremony.
// Browser helpers aren't re-exported from @proofline/webauthn's index
// (intentional — that package's index serves server contexts too), so
// we deep-import from /src/browser.js per the comment in that index.
//
// Types are inferred from function signatures so we don't need a
// direct dep on @simplewebauthn/types.

import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '@proofline/webauthn/src/browser.js';

export {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
};

export type AssertionOptions = Parameters<typeof startAssertionCeremony>[0];
export type AssertionResponse = Awaited<ReturnType<typeof startAssertionCeremony>>;
