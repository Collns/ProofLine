// Build-time configuration. NO secrets here — these are public origins
// that the extension talks to. Replace with environment-specific values
// before publishing.
export const CONFIG = {
  // Backend HTTPS origin the extension calls for sign / verify / sessions.
  // Production: https://api.proofline.web.app
  // Local dev:  http://localhost:5001
  apiOrigin: 'https://app.proofline.web.app',

  // Origin that hosts the web-sign popup (PFL-044). The launcher opens
  // ceremony URLs at `${signOrigin}/sign/{start,silent}` or
  // `${signOrigin}/extension/auth`. Kept as a separate field so it can
  // diverge from apiOrigin if the popup ships behind a different host.
  signOrigin: 'https://app.proofline.web.app',

  // WebAuthn relying-party id — must match the registered RP id on the
  // verifier's side. Per ADR-0012, web-sign uses 'proofline.web.app' so
  // a single credential works for both popup origins.
  rpId: 'proofline.web.app',

  // Verify-page base URL embedded in the inline HTML banner.
  verifyBaseUrl: 'https://verify.proofline.web.app',
} as const;

export type Config = typeof CONFIG;
