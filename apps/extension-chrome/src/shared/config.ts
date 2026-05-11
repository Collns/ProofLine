// Build-time configuration. NO secrets here — these are public origins
// that the extension talks to. Replace with environment-specific values
// before publishing.
export const CONFIG = {
  // Backend HTTPS origin the extension calls for sign / verify / sessions.
  apiOrigin: 'https://app.proofline.web.app',
  // Origin that hosts the web-sign popup (PFL-044).
  signOrigin: 'https://proofline-sign.web.app',
  // WebAuthn relying-party id — must match the actual Firebase Hosting URL.
  rpId: 'proofline-sign.web.app',
  // Verify-page base URL embedded in the inline HTML banner.
  verifyBaseUrl: 'https://proofline-verify.web.app',
} as const;
export type Config = typeof CONFIG;
