/**
 * @file stripe-identity.test.ts
 * @module packages/kyb/src/__tests__
 *
 * Tests for makeStripeIdentityProvider (PFL-013).
 *
 * Webhook handler tests live in:
 *   apps/functions/src/webhooks/__tests__/stripe-identity.test.ts
 */

import { describe, it, expect } from "vitest";
import type Stripe from "stripe";

import { makeStripeIdentityProvider } from "../providers/stripe-identity.js";

// ─── Fake Stripe client ───────────────────────────────────────────────────────

const FAKE_SESSION_ID    = "vs_test_abc123";
const FAKE_CLIENT_SECRET = "vs_test_abc123_secret_xyz";

interface FakeSession {
  id:            string;
  client_secret: string | null;
  status:        string;
  metadata:      Record<string, string>;
}

function makeFakeStripeClient(overrides?: {
  createShouldFail?: boolean;
  omitClientSecret?: boolean;
}) {
  const sessions = new Map<string, FakeSession>();

  return {
    sessions,
    identity: {
      verificationSessions: {
        async create(params: {
          type: string;
          metadata: Record<string, string>;
          options: object;
        }): Promise<FakeSession> {
          if (overrides?.createShouldFail) {
            throw new Error("stripe_error: api connection failed");
          }
          const session: FakeSession = {
            id:            FAKE_SESSION_ID,
            client_secret: overrides?.omitClientSecret ? null : FAKE_CLIENT_SECRET,
            status:        "requires_input",
            metadata:      params.metadata,
          };
          sessions.set(FAKE_SESSION_ID, session);
          return session;
        },
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeStripeIdentityProvider", () => {
  it("throws STRIPE_SECRET_KEY_MISSING if no secretKey and no client", () => {
    expect(() => makeStripeIdentityProvider({ secretKey: "" })).toThrow(
      /STRIPE_SECRET_KEY_MISSING/
    );
  });

  it("verifyBusiness throws WRONG_PROVIDER", async () => {
    const fakeStripe = makeFakeStripeClient();
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });
    await expect(
      provider.verifyBusiness({ legalName: "x", ein: "00-0000000", state: "CA", country: "US" })
    ).rejects.toThrow(/WRONG_PROVIDER/);
  });

  it("throws STRIPE_IDENTITY_INVALID_INPUT if email is empty", async () => {
    const fakeStripe = makeFakeStripeClient();
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });
    await expect(
      provider.verifyOfficer({ email: "" })
    ).rejects.toThrow(/STRIPE_IDENTITY_INVALID_INPUT/);
  });

  it("creates a session and returns pending OfficerVerification", async () => {
    const fakeStripe = makeFakeStripeClient();
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });

    const result = await provider.verifyOfficer({ email: "sarah@acme.com" });

    expect(result.ok).toBe(false);
    expect(result.vendorRef).toBe(FAKE_SESSION_ID);
    expect(result.documentVerified).toBe(false);
    expect(result.livenessConfirmed).toBe(false);
    expect(result.matchedExpected).toBe(false);
    expect((result.raw as { clientSecret: string }).clientSecret).toBe(FAKE_CLIENT_SECRET);
    expect((result.raw as { sessionId: string }).sessionId).toBe(FAKE_SESSION_ID);
  });

  it("includes expectedName in session metadata when provided", async () => {
    const fakeStripe = makeFakeStripeClient();
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });

    await provider.verifyOfficer({ email: "sarah@acme.com", expectedName: "Sarah Connor" });

    const session = fakeStripe.sessions.get(FAKE_SESSION_ID);
    expect(session?.metadata?.["expected_name"]).toBe("Sarah Connor");
  });

  it("throws STRIPE_IDENTITY_SESSION_FAILED when Stripe API errors", async () => {
    const fakeStripe = makeFakeStripeClient({ createShouldFail: true });
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });
    await expect(
      provider.verifyOfficer({ email: "sarah@acme.com" })
    ).rejects.toThrow(/STRIPE_IDENTITY_SESSION_FAILED/);
  });

  it("throws STRIPE_IDENTITY_NO_CLIENT_SECRET when Stripe omits it", async () => {
    const fakeStripe = makeFakeStripeClient({ omitClientSecret: true });
    const provider = makeStripeIdentityProvider({
      secretKey: "sk_test_fake",
      client: fakeStripe as never,
    });
    await expect(
      provider.verifyOfficer({ email: "sarah@acme.com" })
    ).rejects.toThrow(/STRIPE_IDENTITY_NO_CLIENT_SECRET/);
  });
});