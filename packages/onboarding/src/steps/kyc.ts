import {
  ok,
  err,
  type OnboardingError,
  type OnboardingStep,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';

const ALLOWED: OnboardingStep[] = ['kyc_pending'];

export async function startOfficerKycStep(
  input: { onboardingId: string; officerEmail: string; officerName?: string },
  deps: OnboardingDeps,
): Promise<Result<{ vendorRef: string }, OnboardingError>> {
  const ob = await deps.store.get(input.onboardingId);
  if (!ob) return err({ code: 'NOT_FOUND' });

  if (ob.step !== 'kyc_pending') {
    return err({ code: 'BAD_STATE', expected: ALLOWED, actual: ob.step });
  }

  // NOTE (production gap): real Stripe Identity uses an async flow —
  // create a verification session, return clientSecret + sessionId, redirect
  // the user to Stripe's hosted UI, then receive a webhook callback that
  // confirms status. The current @proofline/kyb interface only exposes a
  // synchronous verifyOfficer() that returns a vendorRef. For the hackathon
  // demo this is fine — the wizard can simulate the redirect by chaining
  // start → confirm in two calls. Before real Stripe Identity wiring we'll
  // need to widen @proofline/kyb with startOfficerKycSession + a
  // webhook-driven completion path. Tracked as a separate ticket.
  const result = await deps.kyb.verifyOfficer({
    email: input.officerEmail,
    expectedName: input.officerName,
  });

  if (!result.ok) {
    return err({ code: 'KYC_FAILED', reason: 'verifyOfficer rejected' });
  }

  await deps.store.update(ob.onboardingId, {
    kycVendorRef: result.vendorRef,
    officerEmail: input.officerEmail,
    officerName: input.officerName,
    updatedAt: deps.now(),
  });
  return ok({ vendorRef: result.vendorRef });
}

export async function confirmOfficerKycStep(
  input: { onboardingId: string; vendorSessionId: string },
  deps: OnboardingDeps,
): Promise<Result<{ verified: true }, OnboardingError>> {
  const ob = await deps.store.get(input.onboardingId);
  if (!ob) return err({ code: 'NOT_FOUND' });

  if (ob.step !== 'kyc_pending') {
    return err({ code: 'BAD_STATE', expected: ALLOWED, actual: ob.step });
  }

  if (!ob.kycVendorRef) {
    return err({ code: 'KYC_FAILED', reason: 'no kyc session started' });
  }
  if (ob.kycVendorRef !== input.vendorSessionId) {
    return err({ code: 'KYC_FAILED', reason: 'vendor session mismatch' });
  }

  const now = deps.now();
  await deps.store.update(ob.onboardingId, {
    step: 'finalize_pending',
    kycVerifiedAt: now,
    updatedAt: now,
  });
  return ok({ verified: true });
}
