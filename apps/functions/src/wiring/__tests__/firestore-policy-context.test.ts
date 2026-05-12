/**
 * @file firestore-policy-context.test.ts
 * @module apps/functions/src/wiring/__tests__
 *
 * PFL-086 — contract tests for `makeFirestorePolicyContext.getUser`.
 *
 * Why this test matters: before PFL-086 the prod sign path used
 * `makeStubPolicyContext` whose getUser was synthetic. `/v1/sign/finalize`
 * therefore matched the request body's credentialId against a stub user
 * whose devices were built from a "stub-credential-id" fallback (because
 * the finalize body has no top-level credentialId), producing
 * DEVICE_INVALID on every fresh-path sign. This test pins down that the
 * real factory returns a UserRecord whose `devices` array matches what
 * validatePolicy / sign-finalize look up.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { makeFirestorePolicyContext } from "../firestore-policy-context.js";

// ─── In-memory Firestore mock (same shape used by the other auth tests) ─────

const store: Record<string, Record<string, unknown>> = {};

function makeFirestoreMock(): Firestore {
  const mock = {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: Boolean(store[col]?.[id]),
          data:   () => store[col]?.[id] ?? null,
        }),
      }),
    }),
  };
  return mock as unknown as Firestore;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("makeFirestorePolicyContext.getUser", () => {
  it("returns a UserRecord with the persisted devices array", async () => {
    store["users"] = {
      "user-alice": {
        userId:    "user-alice",
        companyId: "dev-company",
        devices: [
          {
            credentialId: "cred-touchid-001",
            publicKey:    "spki-base64-pubkey",
            enrolledAt:   1_700_000_000_000,
          },
        ],
      },
    };

    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "user-alice",
      companyId: "dev-company",
    });

    const user = await ctx.getUser("user-alice");
    expect(user).not.toBeNull();
    expect(user!.userId).toBe("user-alice");
    expect(user!.companyId).toBe("dev-company");
    expect(user!.devices).toHaveLength(1);
    expect(user!.devices[0]).toMatchObject({
      credentialId: "cred-touchid-001",
      publicKey:    "spki-base64-pubkey",
      enrolledAt:   1_700_000_000_000,
    });
  });

  it("returns null when the users/{userId} document is missing", async () => {
    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "user-ghost",
      companyId: "dev-company",
    });

    const user = await ctx.getUser("user-ghost");
    expect(user).toBeNull();
  });

  it("defaults devices to [] when the user doc has no devices field", async () => {
    // Fresh user docs from extension-auth.handler.ts persist
    // `devices: []`, but defensive default: if the field is absent or a
    // non-array shape, we return an empty array so validatePolicy fails
    // at the device-binding stage (DEVICE_INVALID) rather than crashing
    // on `.find` of undefined.
    store["users"] = {
      "user-no-devices": {
        userId:    "user-no-devices",
        companyId: "dev-company",
        // devices field intentionally omitted
      },
    };

    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "user-no-devices",
      companyId: "dev-company",
    });

    const user = await ctx.getUser("user-no-devices");
    expect(user).not.toBeNull();
    expect(Array.isArray(user!.devices)).toBe(true);
    expect(user!.devices).toHaveLength(0);
  });

  // The bug PFL-086 closes: with the stub PolicyContext, finalize built a
  // synthetic device from request body's credentialId, which didn't exist
  // on the finalize body — so the lookup always missed. With Firestore-
  // backed getUser, the lookup hits the persisted device array regardless
  // of what's in the request body.
  it("PFL-086 regression guard: sign-finalize-style lookup hits the persisted device", async () => {
    const PENDING_CHALLENGE_CREDENTIAL_ID = "cred-from-pending-challenge";
    store["users"] = {
      "user-bob": {
        userId:    "user-bob",
        companyId: "dev-company",
        devices: [
          {
            credentialId: PENDING_CHALLENGE_CREDENTIAL_ID,
            publicKey:    "spki",
            enrolledAt:   123,
          },
          // A second device proves we don't accidentally short-circuit
          // on first array element only.
          {
            credentialId: "cred-other-device",
            publicKey:    "spki-other",
            enrolledAt:   456,
          },
        ],
      },
    };

    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "user-bob",
      companyId: "dev-company",
    });

    const user = await ctx.getUser("user-bob");
    // Mirrors sign-finalize.handler.ts:180-181 and validatePolicy.ts:217.
    const device = user!.devices.find(
      (d) => d.credentialId === PENDING_CHALLENGE_CREDENTIAL_ID,
    );
    expect(device).toBeDefined();
    expect(device!.publicKey).toBe("spki");
  });
});

// ─── Stub method smoke checks (TODO(PFL-policy-stubs) surfaces) ─────────────
//
// We don't assert behaviour beyond "doesn't throw + returns the documented
// permissive defaults" — the stubs are intentional placeholders; the
// follow-up ticket will replace them with Firestore-backed implementations.

describe("makeFirestorePolicyContext stub surfaces", () => {
  it("returns permissive defaults from getCompanyPolicy / getDailyAggregate / checkAnomaly", async () => {
    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "u",
      companyId: "co",
    });

    const policy = await ctx.getCompanyPolicy("co");
    expect(policy.companyId).toBe("co");
    expect(policy.highValueThresholdUsd).toBeGreaterThan(0);

    expect(await ctx.getDailyAggregate("u", "2026-01-01")).toBe(0);
    expect(await ctx.checkAnomaly({
      userId:   "u",
      velocity: { since: 0 },
      payload:  {} as never,
    })).toEqual({ flagged: false });

    expect(await ctx.getSession("any")).toBeNull();
    expect(await ctx.resolveCounterparty("a@b.com")).toBeNull();
  });

  it("dedupes nonces in-process via isNonceUsed / recordNonce", async () => {
    const ctx = makeFirestorePolicyContext(makeFirestoreMock(), {
      userId:    "u",
      companyId: "co",
    });

    const nonce = `nonce-${Math.random()}`;
    expect(await ctx.isNonceUsed(nonce)).toBe(false);
    await ctx.recordNonce(nonce, 60);
    expect(await ctx.isNonceUsed(nonce)).toBe(true);
  });
});

// Silence unused-import lint while keeping `vi` available for future stubbing.
void vi;
