import type { OnboardingDeps } from './deps.js';
import type {
  FinalizeResult,
  OnboardingError,
  Result,
} from './types.js';
import type { KYBFlag } from '@proofline/kyb';
import { startStep, type StartInput } from './steps/start.js';
import { verifyDnsStep } from './steps/verify-dns.js';
import {
  startEmailVerificationStep,
  verifyEmailCodesStep,
} from './steps/verify-email.js';
import { runKybStep } from './steps/kyb.js';
import { startOfficerKycStep, confirmOfficerKycStep } from './steps/kyc.js';
import { finalizeStep } from './steps/finalize.js';

export interface OnboardingService {
  start(
    input: StartInput,
  ): Promise<
    Result<
      {
        onboardingId: string;
        dnsChallenge: { recordName: string; recordValue: string };
      },
      OnboardingError
    >
  >;

  verifyDns(input: {
    onboardingId: string;
  }): Promise<Result<{ verified: true }, OnboardingError>>;

  startEmailVerification(input: {
    onboardingId: string;
  }): Promise<Result<{ codesSent: number }, OnboardingError>>;

  verifyEmailCodes(input: {
    onboardingId: string;
    adminCode: string;
    postmasterCode: string;
  }): Promise<Result<{ verified: true }, OnboardingError>>;

  runKyb(input: {
    onboardingId: string;
    legalName: string;
    ein: string;
    state: string;
  }): Promise<
    Result<
      { status: 'approved' | 'review' | 'rejected'; flags: KYBFlag[] },
      OnboardingError
    >
  >;

  startOfficerKyc(input: {
    onboardingId: string;
    officerEmail: string;
    officerName?: string;
  }): Promise<Result<{ vendorRef: string }, OnboardingError>>;

  confirmOfficerKyc(input: {
    onboardingId: string;
    vendorSessionId: string;
  }): Promise<Result<{ verified: true }, OnboardingError>>;

  finalize(input: {
    onboardingId: string;
    officerWebAuthnPublicKey: string;
    officerCredentialId: string;
  }): Promise<Result<FinalizeResult, OnboardingError>>;
}

export function makeOnboardingService(deps: OnboardingDeps): OnboardingService {
  return {
    start: (input) => startStep(input, deps),
    verifyDns: (input) => verifyDnsStep(input, deps),
    startEmailVerification: (input) => startEmailVerificationStep(input, deps),
    verifyEmailCodes: (input) => verifyEmailCodesStep(input, deps),
    runKyb: (input) => runKybStep(input, deps),
    startOfficerKyc: (input) => startOfficerKycStep(input, deps),
    confirmOfficerKyc: (input) => confirmOfficerKycStep(input, deps),
    finalize: (input) => finalizeStep(input, deps),
  };
}
