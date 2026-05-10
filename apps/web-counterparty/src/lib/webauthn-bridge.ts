/**
 * Thin wrapper over @proofline/webauthn so the cosign surface only depends
 * on the abstractions it needs and tests can stub the ceremony.
 *
 * Per F-SES-08, cosign approvals ALWAYS require a fresh biometric — we set
 * userVerification: 'required' and never reuse a session token. Per
 * F-SIG-09, this function MUST only be invoked after the verify-checklist
 * has reached `allPassed: true`.
 *
 * Browser helpers aren't re-exported from `@proofline/webauthn` (kept off
 * the index so server contexts can import safely). Mirror the pattern used
 * by apps/web-admin: import the submodule directly and infer types from
 * function signatures.
 */

import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '@proofline/webauthn/src/browser.js';

export type AssertionResponse = Awaited<ReturnType<typeof startAssertionCeremony>>;

export interface CosignAssertionInput {
  /** base64url challenge from the server's getCosignContext response. */
  challenge: string;
  /** Restricting to a known credentialId is optional; if omitted, the
   *  authenticator will discover any resident credential for this RP. */
  allowedCredentialId?: string;
  /** Default: location.hostname; overrideable for tests. */
  rpId?: string;
  /** Default: 60s. */
  timeoutMs?: number;
}

export type CosignAssertionResult =
  | { ok: true;  assertion: AssertionResponse }
  | { ok: false; code: 'USER_CANCELLED' | 'DEVICE_UNSUPPORTED' | 'ABORTED' | 'UNKNOWN'; detail: string };

export async function runCosignAssertion(input: CosignAssertionInput): Promise<CosignAssertionResult> {
  const rpId = input.rpId ?? (typeof window !== 'undefined' ? window.location.hostname : 'localhost');

  try {
    const assertion = await startAssertionCeremony({
      challenge:        input.challenge,
      rpId,
      timeout:          input.timeoutMs ?? 60_000,
      userVerification: 'required',
      allowCredentials: input.allowedCredentialId
        ? [{ id: input.allowedCredentialId, type: 'public-key' }]
        : [],
    });
    return { ok: true, assertion };
  } catch (err) {
    if (err instanceof UserCancelled)      return { ok: false, code: 'USER_CANCELLED',     detail: err.message };
    if (err instanceof DeviceUnsupported)  return { ok: false, code: 'DEVICE_UNSUPPORTED', detail: err.message };
    if (err instanceof WebAuthnAbortError) return { ok: false, code: 'ABORTED',            detail: err.message };
    return { ok: false, code: 'UNKNOWN', detail: (err as Error).message };
  }
}
