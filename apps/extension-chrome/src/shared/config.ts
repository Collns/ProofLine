// Build-time configuration. NO secrets here — these are public origins
// that the extension talks to. Replace with environment-specific values
// before publishing.
// Each value may be overridden at build time via the matching env var
// (see esbuild.config.mjs) so the same source builds for staging. Unset →
// production defaults, so a plain `pnpm build` is unchanged.
export const CONFIG = {
  // Backend HTTPS origin the extension calls for sign / verify / sessions.
  // This is the deployed Firebase Functions `api` HTTP function — not a
  // hosting site (a hosting site has no /v1/* routes without a rewrite,
  // which we deliberately haven't added yet).
  apiOrigin: process.env.EXT_API_ORIGIN || 'https://us-central1-proofline-cdabb.cloudfunctions.net/api',
  // Origin that hosts the web-sign popup (PFL-044).
  signOrigin: process.env.EXT_SIGN_ORIGIN || 'https://proofline-sign.web.app',
  // WebAuthn relying-party id — must match the actual Firebase Hosting URL.
  rpId: process.env.EXT_RP_ID || 'proofline-sign.web.app',
  // Verify-page base URL embedded in the inline HTML banner.
  verifyBaseUrl: process.env.EXT_VERIFY_BASE_URL || 'https://proofline-verify.web.app',
} as const;
export type Config = typeof CONFIG;
