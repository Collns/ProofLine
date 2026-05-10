import {
  ok,
  err,
  type OnboardingError,
  type OnboardingStep,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';

const ALLOWED: OnboardingStep[] = ['dns_pending'];

export async function verifyDnsStep(
  input: { onboardingId: string },
  deps: OnboardingDeps,
): Promise<Result<{ verified: true }, OnboardingError>> {
  const state = await deps.store.get(input.onboardingId);
  if (!state) return err({ code: 'NOT_FOUND' });

  // Idempotent: if already verified, return ok without re-resolving
  if (state.step !== 'dns_pending' && state.dnsVerifiedAt) {
    return ok({ verified: true });
  }
  if (!ALLOWED.includes(state.step)) {
    return err({ code: 'BAD_STATE', expected: ALLOWED, actual: state.step });
  }

  let txtRecords: string[][];
  try {
    txtRecords = await deps.dns.resolveTxt(state.dnsRecordName);
  } catch {
    return err({ code: 'DNS_NOT_FOUND', expected: state.dnsRecordValue });
  }

  // resolveTxt returns string[][]; each inner array is the chunked TXT record
  const flattened = txtRecords.map((chunks) => chunks.join(''));
  const found = flattened.includes(state.dnsRecordValue);
  if (!found) {
    return err({ code: 'DNS_NOT_FOUND', expected: state.dnsRecordValue });
  }

  const now = deps.now();
  await deps.store.update(state.onboardingId, {
    step: 'email_pending',
    dnsVerifiedAt: now,
    updatedAt: now,
  });
  return ok({ verified: true });
}
