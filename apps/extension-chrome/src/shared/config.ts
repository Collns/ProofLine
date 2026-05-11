// Build-time configuration. NO secrets here — these are public origins
// that the extension talks to. Replace with environment-specific values
// before publishing.
export const CONFIG = {
  // Backend HTTPS origin the extension calls for sign / verify / sessions.
  // Production: https://api.proofline.web.app
  // Local dev:  http://localhost:5001
  apiOrigin: 'https://app.proofline.web.app',

  // WebAuthn relying-party id — must match the registered RP id on the
  // verifier's side. Used by future signing flows; placeholder for now.
  rpId: 'proofline-sign.web.app',

  // Verify-page base URL embedded in the inline HTML banner.
  verifyBaseUrl: 'https://verify.proofline.web.app',
} as const;

export type Config = typeof CONFIG;
