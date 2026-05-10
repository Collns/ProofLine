import {
  ok,
  err,
  EMAIL_LOCKOUT_THRESHOLD,
  type OnboardingError,
  type OnboardingStep,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';
import { defaultRandomCode, timingSafeEq } from '../util.js';

const ALLOWED_FOR_START: OnboardingStep[] = ['email_pending'];
const ALLOWED_FOR_VERIFY: OnboardingStep[] = ['email_pending'];

export async function startEmailVerificationStep(
  input: { onboardingId: string },
  deps: OnboardingDeps,
): Promise<Result<{ codesSent: number }, OnboardingError>> {
  const state = await deps.store.get(input.onboardingId);
  if (!state) return err({ code: 'NOT_FOUND' });

  if (state.step !== 'email_pending') {
    return err({
      code: 'BAD_STATE',
      expected: ALLOWED_FOR_START,
      actual: state.step,
    });
  }

  const code = deps.randomCode ?? defaultRandomCode;
  const adminCode = code();
  let postmasterCode = code();
  // Guarantee distinct codes (collision is astronomically unlikely but cheap to defend)
  while (postmasterCode === adminCode) postmasterCode = code();

  await deps.email.sendVerificationCode(`admin@${state.domain}`, adminCode);
  await deps.email.sendVerificationCode(`postmaster@${state.domain}`, postmasterCode);

  await deps.store.update(state.onboardingId, {
    adminCode,
    postmasterCode,
    emailAttempts: 0,
    updatedAt: deps.now(),
  });

  return ok({ codesSent: 2 });
}

export async function verifyEmailCodesStep(
  input: { onboardingId: string; adminCode: string; postmasterCode: string },
  deps: OnboardingDeps,
): Promise<Result<{ verified: true }, OnboardingError>> {
  const state = await deps.store.get(input.onboardingId);
  if (!state) return err({ code: 'NOT_FOUND' });

  if (state.step !== 'email_pending') {
    return err({
      code: 'BAD_STATE',
      expected: ALLOWED_FOR_VERIFY,
      actual: state.step,
    });
  }

  if (!state.adminCode || !state.postmasterCode) {
    return err({
      code: 'BAD_STATE',
      expected: ALLOWED_FOR_VERIFY,
      actual: state.step,
    });
  }

  if (state.emailAttempts >= EMAIL_LOCKOUT_THRESHOLD) {
    return err({ code: 'LOCKED_OUT', attempts: state.emailAttempts });
  }

  const adminOk = timingSafeEq(input.adminCode, state.adminCode);
  const postmasterOk = timingSafeEq(input.postmasterCode, state.postmasterCode);

  if (!adminOk || !postmasterOk) {
    const attempts = state.emailAttempts + 1;
    await deps.store.update(state.onboardingId, {
      emailAttempts: attempts,
      updatedAt: deps.now(),
    });
    if (attempts >= EMAIL_LOCKOUT_THRESHOLD) {
      return err({ code: 'LOCKED_OUT', attempts });
    }
    return err({ code: 'CODE_INVALID' });
  }

  const now = deps.now();
  await deps.store.update(state.onboardingId, {
    step: 'kyb_pending',
    emailVerifiedAt: now,
    updatedAt: now,
  });
  return ok({ verified: true });
}
