/**
 * @file stubs.ts
 * @module apps/functions/src/wiring
 *
 * Stub dependencies for local development and tests. They are selected
 * explicitly through loadConfig() (e.g. KMS_PROVIDER=stub) by
 * wiring/providers.ts and are never a silent fallback (PFL-169). KMS and
 * anchor stubs are refused in production; KYB/IDV stubs are allowed but
 * their results must go to manual review (PFL-162/177).
 *
 * Design rules for these stubs:
 *   - They MUST satisfy the interfaces declared by the handlers.
 *   - They MUST return JSON (no thrown errors that bubble to a 500).
 *   - They MUST be permissive enough that a normal sign attempt with
 *     a valid request body produces an APPROVED-shaped response — so a
 *     client integrator can iterate end-to-end without server-side
 *     auth/KMS infrastructure.
 *   - They MUST NOT pretend to do crypto: any "signature" returned by
 *     these stubs is a fixed sentinel string, NEVER a real signature.
 */

import type {
  CompanyPolicy,
  PolicyContext,
  UserRecord,
} from "@proofline/types";

import type { KYBProvider } from "../api/onboarding/kyb.handler.js";
import type { StripeIdentityProvider } from "../api/onboarding/enroll-officer.handler.js";
import type { KmsProvider } from "../api/onboarding/finalize.handler.js";

// ─── Stub PolicyContext ──────────────────────────────────────────────────────
//
// A PolicyContext that approves any valid-shaped sign request:
//   - getUser:           returns a permissive user whose `devices` array
//                        contains the credentialId from this request, so
//                        the device-binding check (Stage X) passes.
//   - getSession:        null (fresh-path only for now — silent path will
//                        produce SESSION_INVALID until session storage
//                        is wired).
//   - getCompanyPolicy:  generous limits + a high HVT threshold so wire
//                        instructions don't trip cosign by default.
//   - getDailyAggregate: 0  (no spend history → daily limits don't fire).
//   - resolveCounterparty / checkAnomaly / revokeSession: no-op.
//   - isNonceUsed / recordNonce: in-memory map scoped per process; this
//                        prevents trivial replay within a single instance
//                        but does NOT survive across cold starts. The
//                        real implementation lives behind Firestore.
//
// `credentialId` is the only request-derived input — caller passes it
// through so getUser can mint a matching device record.

const inMemoryNonces = new Set<string>();

export interface StubPolicyContextInput {
  /** Pulled from the request body so getUser can include it in the user's devices. */
  credentialId: string;
  /** Caller identity, normally from auth middleware. */
  userId: string;
  companyId: string;
}

export function makeStubPolicyContext(input: StubPolicyContextInput): PolicyContext {
  const stubUser: UserRecord = {
    userId:        input.userId,
    companyId:     input.companyId,
    status:        "active",
    role:          "owner",
    wireLimitUsd:  10_000_000,
    dailyLimitUsd: 100_000_000,
    devices: [
      {
        credentialId: input.credentialId,
        publicKey:    "spki-base64-placeholder",
        enrolledAt:   0,
      },
    ],
  };

  const stubPolicy: CompanyPolicy = {
    companyId:        input.companyId,
    highValueThresholdUsd: 10_000_000,
    sessionTtlMs:     15 * 60 * 1000,
    sessionHardCapMs: 60 * 60 * 1000,
    cosignTtlMs:      30 * 60 * 1000,
  };

  return {
    async getUser(userId) {
      return userId === input.userId ? stubUser : null;
    },
    async getSession(_sessionId) {
      return null;
    },
    async getCompanyPolicy(_companyId) {
      return stubPolicy;
    },
    async getDailyAggregate(_userId, _day) {
      return 0;
    },
    async resolveCounterparty(_email) {
      return null;
    },
    async checkAnomaly(_input) {
      return { flagged: false };
    },
    async revokeSession(_sessionId, _reason, _by) {
      /* no-op */
    },
    async isNonceUsed(nonce) {
      return inMemoryNonces.has(nonce);
    },
    async recordNonce(nonce, _ttlSeconds) {
      inMemoryNonces.add(nonce);
    },
    now: () => Date.now(),
  };
}

// ─── Stub onboarding dependencies ────────────────────────────────────────────
//
// Each provider returns a fixture-shaped response and touches no external
// service. Selected only when the matching *_PROVIDER=stub.

export const stubKybProvider: KYBProvider = {
  async verifyBusiness(input) {
    return {
      ok:        true,
      vendorRef: `stub-kyb-${input.ein.replace(/\D+/g, "")}`,
      flags:     [],
      officers:  [{ name: "Stub Officer", role: "owner" }],
      raw:       { stub: true },
    };
  },
};

export const stubStripeIdentityProvider: StripeIdentityProvider = {
  provider: "stub",
  async verifyOfficer(input) {
    const sessionId = `stub-stripe-${Date.now().toString(36)}`;
    return {
      ok:                true,
      vendorRef:         sessionId,
      documentVerified:  true,
      livenessConfirmed: true,
      matchedExpected:   true,
      raw: {
        clientSecret: null,
        sessionId,
      },
    };
  },
};

export const stubKmsProvider: KmsProvider = {
  async createCompanyRootKey(companyId) {
    return { keyName: `projects/stub/locations/global/keyRings/stub/cryptoKeys/${companyId}/cryptoKeyVersions/1` };
  },
  async signWithKms(_keyName, _messageBytes) {
    // Sentinel: NOT a real signature. The verify endpoint and audit log
    // will reject anything signed with this value — that's intentional.
    return "stub-signature-not-cryptographic";
  },
  async exportPublicKey(_keyName) {
    return "stub-spki-base64";
  },
};
