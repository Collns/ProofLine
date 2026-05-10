// Wraps @proofline/webauthn for the registration ceremony used in the
// Key Ceremony step. The browser helpers aren't re-exported from the
// package's index per packages/webauthn/src/index.ts (intentional, to keep
// server contexts safe). We import the browser submodule directly.
//
// Types are inferred from the function signatures so we don't need a direct
// dep on @simplewebauthn/types.

import {
  startRegistrationCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '@proofline/webauthn/src/browser.js';

export {
  startRegistrationCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
};

type RegistrationOptions = Parameters<typeof startRegistrationCeremony>[0];
export type RegistrationResponse = Awaited<ReturnType<typeof startRegistrationCeremony>>;

// Convenience: build placeholder registration options for the ceremony.
// Real production wiring will fetch options from /v1/webauthn/start
// (separate ticket — finalize.handler.ts comments reference it as
// "/v1/webauthn/enroll" for the WebAuthn key enrollment).
export function makePlaceholderRegistrationOptions(opts: {
  rpId: string;
  rpName: string;
  userId: string;
  userName: string;
  userDisplayName: string;
}): RegistrationOptions {
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = bytesToBase64Url(challengeBytes);

  const userIdBytes = new TextEncoder().encode(opts.userId);
  const userIdB64u = bytesToBase64Url(userIdBytes);

  return {
    rp:                     { id: opts.rpId, name: opts.rpName },
    user:                   { id: userIdB64u, name: opts.userName, displayName: opts.userDisplayName },
    challenge,
    pubKeyCredParams:       [
      { type: 'public-key', alg: -7  },  // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout:                60_000,
    attestation:            'none',
    authenticatorSelection: {
      residentKey:      'preferred',
      userVerification: 'required',
    },
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
