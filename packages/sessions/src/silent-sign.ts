import {
  runPolicyChecks,
  type PolicyDeps,
  type PolicyError,
  type PolicyRequest,
  type PolicyResult,
} from '@proofline/policy';
import type { WebAuthnAssertion } from '@proofline/webauthn';
import type { SessionService } from './service.js';
import {
  type SessionError,
  type SigningSession,
  type Result,
  ok,
  err,
} from './types.js';
import { recipientSetHash } from './recipient-set.js';
import type { EnvelopeRecord } from './envelope-record.js';

export interface AssertionVerifierInput {
  assertion: WebAuthnAssertion;
  expectedChallenge: string;
  credentialId: string;
  storedPublicKey: string;
  storedSignCount: number;
}

export type AssertionVerifyResult =
  | { ok: true; newSignCount: number }
  | { ok: false; reason: string };

export interface AssertionVerifier {
  verify(input: AssertionVerifierInput): Promise<AssertionVerifyResult>;
}

export type SilentSignError =
  | { code: 'SESSION_INVALID'; sessionError: SessionError }
  | { code: 'POLICY_FAILED'; policyError: PolicyError }
  | { code: 'FRESH_BIOMETRIC_REQUIRED'; reason: 'high_value' | 'session_expired' }
  | { code: 'ASSERTION_INVALID'; reason: string }
  | { code: 'CHALLENGE_MISMATCH' }
  | { code: 'SESSION_HARD_CAP_REACHED' }
  | { code: 'INTERNAL'; message: string };

export interface SilentSignChallengeInput {
  sessionToken: string;
  recipientAddresses: string[];
  canonicalPayloadHash: string;
  policyRequest: PolicyRequest;
}

export interface SilentSignFinalizeInput {
  sessionToken: string;
  recipientAddresses: string[];
  canonicalPayloadHash: string;
  step1ChallengeHash: string;
  assertion: WebAuthnAssertion;
  policyRequest: PolicyRequest;
}

export interface StoredCredential {
  publicKey: string;
  signCount: number;
}

export interface SilentSignDeps {
  sessionService: SessionService;
  policyDeps: PolicyDeps;
  assertionVerifier: AssertionVerifier;
  getCredential: (credentialId: string) => Promise<StoredCredential | null>;
  now: () => number;
  // Optional: invoked after a successful finalize so the caller can persist
  // the new signCount alongside the EnvelopeRecord. Not required for the
  // coordinator's own bookkeeping.
  onSignCountUpdate?: (input: { credentialId: string; newSignCount: number }) => Promise<void>;
  // Test seam: override the policy pipeline. Defaults to runPolicyChecks.
  runPolicy?: (req: PolicyRequest, deps: PolicyDeps) => Promise<PolicyResult>;
}

export interface SilentSignCoordinator {
  silentSignChallenge(
    input: SilentSignChallengeInput,
  ): Promise<Result<{ challenge: string; sessionId: string }, SilentSignError>>;

  silentSignFinalize(
    input: SilentSignFinalizeInput,
  ): Promise<
    Result<{ envelopeRecord: EnvelopeRecord; session: SigningSession }, SilentSignError>
  >;
}

function mapSessionErrorToSilent(error: SessionError): SilentSignError {
  if (error.code === 'SESSION_HARD_CAP_REACHED') {
    return { code: 'SESSION_HARD_CAP_REACHED' };
  }
  return { code: 'SESSION_INVALID', sessionError: error };
}

function mapPolicyErrorToSilent(error: PolicyError): SilentSignError {
  if (error.code === 'FRESH_BIOMETRIC_REQUIRED') {
    return { code: 'FRESH_BIOMETRIC_REQUIRED', reason: 'high_value' };
  }
  return { code: 'POLICY_FAILED', policyError: error };
}

export function makeSilentSignCoordinator(
  deps: SilentSignDeps,
): SilentSignCoordinator {
  const runPolicy = deps.runPolicy ?? runPolicyChecks;

  async function validateSessionAndPolicy(
    sessionToken: string,
    recipientAddresses: string[],
    policyRequest: PolicyRequest,
  ): Promise<Result<SigningSession, SilentSignError>> {
    const rsh = recipientSetHash(recipientAddresses);

    const sessionResult = await deps.sessionService.validate({
      token: sessionToken,
      recipientSetHash: rsh,
    });
    if (!sessionResult.ok) {
      return err(mapSessionErrorToSilent(sessionResult.error));
    }

    const policyResult = await runPolicy(policyRequest, deps.policyDeps);
    if (!policyResult.ok) {
      return err(mapPolicyErrorToSilent(policyResult.error));
    }

    return ok(sessionResult.value);
  }

  return {
    async silentSignChallenge(input) {
      const validated = await validateSessionAndPolicy(
        input.sessionToken,
        input.recipientAddresses,
        input.policyRequest,
      );
      if (!validated.ok) return err(validated.error);

      return ok({
        challenge: input.canonicalPayloadHash,
        sessionId: validated.value.sessionId,
      });
    },

    async silentSignFinalize(input) {
      if (input.step1ChallengeHash !== input.canonicalPayloadHash) {
        return err({ code: 'CHALLENGE_MISMATCH' });
      }

      const validated = await validateSessionAndPolicy(
        input.sessionToken,
        input.recipientAddresses,
        input.policyRequest,
      );
      if (!validated.ok) return err(validated.error);
      const session = validated.value;

      const credential = await deps.getCredential(input.assertion.credentialId);
      if (!credential) {
        return err({ code: 'ASSERTION_INVALID', reason: 'credential_not_found' });
      }

      const verifyResult = await deps.assertionVerifier.verify({
        assertion: input.assertion,
        expectedChallenge: input.canonicalPayloadHash,
        credentialId: input.assertion.credentialId,
        storedPublicKey: credential.publicKey,
        storedSignCount: credential.signCount,
      });
      if (!verifyResult.ok) {
        return err({ code: 'ASSERTION_INVALID', reason: verifyResult.reason });
      }

      if (deps.onSignCountUpdate) {
        await deps.onSignCountUpdate({
          credentialId: input.assertion.credentialId,
          newSignCount: verifyResult.newSignCount,
        });
      }

      const envelopeRecord: EnvelopeRecord = {
        sessionId: session.sessionId,
        userId: session.userId,
        companyId: session.companyId,
        credentialId: input.assertion.credentialId,
        canonicalPayloadHash: input.canonicalPayloadHash,
        signature: input.assertion.signature,
        signedAt: deps.now(),
        recipientAddresses: [...input.recipientAddresses],
      };

      const extended = await deps.sessionService.extend(session.sessionId);
      if (!extended.ok) {
        return err(mapSessionErrorToSilent(extended.error));
      }

      return ok({ envelopeRecord, session: extended.value });
    },
  };
}
