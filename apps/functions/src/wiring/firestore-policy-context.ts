/**
 * @file firestore-policy-context.ts
 * @module apps/functions/src/wiring
 *
 * Production PolicyContext (PFL-086). Replaces the synthetic
 * `makeStubPolicyContext` from `stubs.ts` for the signing routes wired in
 * `index.ts`.
 *
 * Scope of this PR:
 *   - Only `getUser` is Firestore-backed. It reads `users/{userId}` (written
 *     by PFL-084's register-credential.handler.ts) and returns a UserRecord
 *     whose `devices` array drives validatePolicy's device check and
 *     sign-finalize's device lookup.
 *   - Every other PolicyContext method retains permissive in-memory stub
 *     behaviour and is marked TODO(PFL-policy-stubs) so the follow-up
 *     ticket is visible at the call site.
 *
 * Why `makeStubPolicyContext` stays alongside this:
 *   - Unit tests that construct a PolicyContext in-process (e.g. the
 *     signing integration tests) need a fully synthetic ctx without
 *     Firestore plumbing. Don't delete it.
 */

import type { Firestore } from "firebase-admin/firestore";
import type {
  CompanyPolicy,
  PolicyContext,
  UserRecord,
} from "@proofline/types";

// ─── Module state ─────────────────────────────────────────────────────────────
// TODO(PFL-policy-stubs): nonce dedupe should live in Firestore (collection
// `nonces/{nonce}` with a TTL). The in-memory set survives only a single
// container's warm window — cold starts and multi-instance fan-out give
// trivially-replayable nonces in the meantime.

const inMemoryNonces = new Set<string>();

// ─── Demo defaults for not-yet-wired surfaces ────────────────────────────────
// Mirrors `stubs.ts` so callers see the same permissive numbers under the
// real Firestore path until the follow-up wires Firestore-backed policy /
// session / counterparty surfaces.

const DEMO_COMPANY_POLICY: Omit<CompanyPolicy, "companyId"> = {
  highValueThresholdUsd: 10_000_000,
  sessionTtlMs:          15 * 60 * 1000,
  sessionHardCapMs:      60 * 60 * 1000,
  cosignTtlMs:           30 * 60 * 1000,
};

// ─── Public API ──────────────────────────────────────────────────────────────

export interface FirestorePolicyContextInput {
  /** Caller identity from the auth middleware. */
  userId: string;
  companyId: string;
}

export function makeFirestorePolicyContext(
  firestore: Firestore,
  input: FirestorePolicyContextInput,
): PolicyContext {
  return {
    // ── Real Firestore read ───────────────────────────────────────────────
    //
    // Returns `null` when the user doc is absent — validatePolicy then
    // fails the request with USER_INACTIVE, which is the correct response
    // for "no such user". We never fabricate a stub user here; the prior
    // synthetic implementation in `stubs.ts` was the demo blocker that
    // motivated PFL-086.
    async getUser(userId: string): Promise<UserRecord | null> {
      const snap = await firestore.collection("users").doc(userId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;

      return {
        userId,
        companyId:
          typeof data["companyId"] === "string" ? (data["companyId"] as string) : "",
        // status / role are not yet populated by onboarding writes
        // (extension-auth + register-credential omit them). Default to
        // permissive values that pass validatePolicy's stage-2/3 checks.
        // TODO(PFL-policy-stubs): persist role + status during onboarding.
        status:
          (typeof data["status"] === "string"
            ? (data["status"] as UserRecord["status"])
            : "active"),
        role:
          (typeof data["role"] === "string"
            ? (data["role"] as UserRecord["role"])
            : "owner"),
        // Wire / daily limits aren't persisted yet. Default to 0 — the
        // email-signing demo path doesn't touch these (validatePolicy's
        // stage-4 only runs for `isWireInstruction`). Wire-signing demos
        // will require populating these per-user.
        // TODO(PFL-policy-stubs): persist + read real authority limits.
        wireLimitUsd:
          typeof data["wireLimitUsd"] === "number"
            ? (data["wireLimitUsd"] as number)
            : 0,
        dailyLimitUsd:
          typeof data["dailyLimitUsd"] === "number"
            ? (data["dailyLimitUsd"] as number)
            : 0,
        // The whole point of PFL-086: read the array PFL-084 writes.
        devices: Array.isArray(data["devices"])
          ? (data["devices"] as UserRecord["devices"])
          : [],
      };
    },

    // ── Stubs (each tracked under PFL-policy-stubs) ───────────────────────

    // TODO(PFL-policy-stubs): read `sessions/{sessionId}` from Firestore.
    // Until then the silent-sign path will always fail validatePolicy with
    // SESSION_INVALID, which is the safe default.
    async getSession(_sessionId) {
      return null;
    },

    // TODO(PFL-policy-stubs): read `companies/{companyId}.policy` from
    // Firestore. The demo defaults keep the email-signing path APPROVED.
    async getCompanyPolicy(companyId: string): Promise<CompanyPolicy> {
      return { companyId, ...DEMO_COMPANY_POLICY };
    },

    // TODO(PFL-policy-stubs): aggregate `signed_messages` by day for the
    // wire-aggregate check. Zero is safe for email signing.
    async getDailyAggregate(_userId, _day) {
      return 0;
    },

    // TODO(PFL-policy-stubs): look up `counterparties/{email}`.
    async resolveCounterparty(_email) {
      return null;
    },

    // TODO(PFL-policy-stubs): real velocity + payload heuristics; for now
    // we never flag.
    async checkAnomaly(_input) {
      return { flagged: false };
    },

    // TODO(PFL-policy-stubs): write `sessions/{sessionId}.status=revoked`
    // alongside session storage.
    async revokeSession(_sessionId, _reason, _by) {
      /* no-op until session storage lands */
    },

    // TODO(PFL-policy-stubs): swap to `nonces/{nonce}` Firestore doc with
    // a TTL. In-memory dedupe only catches replays within a single warm
    // instance.
    async isNonceUsed(nonce) {
      return inMemoryNonces.has(nonce);
    },
    async recordNonce(nonce, _ttlSeconds) {
      inMemoryNonces.add(nonce);
    },

    now: () => Date.now(),
  };
}
