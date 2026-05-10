import {
  type OnboardingService,
  type OnboardingDeps,
  makeOnboardingService,
} from '@proofline/onboarding';

let cached: OnboardingService | null = null;

/**
 * Wire OnboardingService deps once at boot. Production should call this from
 * apps/functions/src/index.ts with: Firestore-backed OnboardingStore,
 * makeMiddeskProvider (KYB), makeResendProvider (email), Cloud KMS-backed
 * CryptoProvider + KmsKeyProvisioner, makeViemBaseSepoliaAnchorProvider, and
 * dns/promises-backed DNSResolver. Production wiring lives in a separate ticket.
 */
export function wireOnboardingService(deps: OnboardingDeps): void {
  cached = makeOnboardingService(deps);
}

export function getOnboardingService(): OnboardingService {
  if (!cached) {
    throw new Error(
      'OnboardingService not wired. Call wireOnboardingService(deps) at boot.',
    );
  }
  return cached;
}
