import {
  ok,
  type OnboardingError,
  type OnboardingState,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';
import { defaultUuid, dnsTokenFor } from '../util.js';

export interface StartInput {
  domain: string;
  legalName?: string;
  officerEmail?: string;
}

export async function startStep(
  input: StartInput,
  deps: OnboardingDeps,
): Promise<
  Result<
    {
      onboardingId: string;
      dnsChallenge: { recordName: string; recordValue: string };
    },
    OnboardingError
  >
> {
  const onboardingId = (deps.uuid ?? defaultUuid)();
  const now = deps.now();
  const recordName = `_proofline.${input.domain}`;
  const recordValue = `proofline-verify=${dnsTokenFor(onboardingId)}`;

  const state: OnboardingState = {
    onboardingId,
    step: 'dns_pending',
    domain: input.domain,
    legalName: input.legalName,
    officerEmail: input.officerEmail,
    dnsRecordName: recordName,
    dnsRecordValue: recordValue,
    emailAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  await deps.store.create(state);
  return ok({
    onboardingId,
    dnsChallenge: { recordName, recordValue },
  });
}
