/**
 * Onboarding HTTP layer (Firebase Functions v2).
 *
 * Each handler is a thin wrapper: zod-parse the body → call the
 * OnboardingService → JSON response or RFC 7807-style problem detail.
 *
 * Production wiring (Firestore-backed OnboardingStore, Middesk + Resend +
 * Cloud KMS + viem providers, dns/promises DNSResolver) is performed at
 * boot via `wireOnboardingService(deps)`. That wiring lives in a separate
 * ticket; this slice only ships the handler scaffolding + service-factory.
 *
 * Deploy with `firebase deploy --only functions` once wiring is complete.
 */

export { wireOnboardingService, getOnboardingService } from './service-factory.js';

export { onboardingStart } from './start.js';
export { onboardingVerifyDns } from './verify-dns.js';
export {
  onboardingStartEmailVerification,
  onboardingVerifyEmail,
} from './verify-email.js';
export { onboardingKyb } from './kyb.js';
export { onboardingStartKyc, onboardingConfirmKyc } from './kyc.js';
export { onboardingFinalize } from './finalize.js';
