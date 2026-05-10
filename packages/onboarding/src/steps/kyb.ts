import {
  ok,
  err,
  type OnboardingError,
  type OnboardingStep,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';
import type { KYBFlag } from '@proofline/kyb';

const ALLOWED: OnboardingStep[] = ['kyb_pending'];

export async function runKybStep(
  input: {
    onboardingId: string;
    legalName: string;
    ein: string;
    state: string;
  },
  deps: OnboardingDeps,
): Promise<
  Result<
    { status: 'approved' | 'review' | 'rejected'; flags: KYBFlag[] },
    OnboardingError
  >
> {
  const ob = await deps.store.get(input.onboardingId);
  if (!ob) return err({ code: 'NOT_FOUND' });

  if (ob.step !== 'kyb_pending') {
    return err({ code: 'BAD_STATE', expected: ALLOWED, actual: ob.step });
  }

  const result = await deps.kyb.verifyBusiness({
    legalName: input.legalName,
    ein: input.ein,
    state: input.state,
    country: 'US',
  });

  const now = deps.now();
  if (!result.ok) {
    await deps.store.update(ob.onboardingId, {
      step: 'rejected',
      kybVendorRef: result.vendorRef,
      kybFlags: result.flags,
      legalName: input.legalName,
      ein: input.ein,
      jurisdiction: input.state,
      updatedAt: now,
    });
    return err({ code: 'KYB_REJECTED', flags: result.flags });
  }

  const hasMediumOrHighFlag = result.flags.some(
    (f) => f.severity === 'medium' || f.severity === 'high',
  );
  if (hasMediumOrHighFlag) {
    await deps.store.update(ob.onboardingId, {
      step: 'manual_review',
      kybVendorRef: result.vendorRef,
      kybFlags: result.flags,
      legalName: input.legalName,
      ein: input.ein,
      jurisdiction: input.state,
      updatedAt: now,
    });
    return err({ code: 'KYB_REVIEW', flags: result.flags });
  }

  await deps.store.update(ob.onboardingId, {
    step: 'kyc_pending',
    kybVendorRef: result.vendorRef,
    kybFlags: result.flags,
    legalName: input.legalName,
    ein: input.ein,
    jurisdiction: input.state,
    updatedAt: now,
  });
  return ok({ status: 'approved', flags: result.flags });
}
