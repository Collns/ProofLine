/**
 * @file stripe-identity.ts
 * @module packages/kyb/src/providers
 *
 * Stripe Identity provider for ProofLine officer KYC.
 *
 * Per TDD §7.2 and PFL-013:
 *   - Creates a VerificationSession with type=document,
 *     require_live_capture=true, require_matching_selfie=true.
 *   - Returns clientSecret for browser embed (Stripe Identity JS).
 *   - Session result arrives via webhook — see
 *     apps/functions/src/webhooks/stripe-identity.ts.
 *
 * The returned OfficerVerification has ok=false (pending) since
 * verification is async. The webhook handler flips the company doc
 * to ok=true once identity.verification_session.verified fires.
 *
 * Usage:
 *   const provider = makeStripeIdentityProvider({ secretKey: process.env.STRIPE_SECRET_KEY! });
 *   const result   = await provider.verifyOfficer({ email: "sarah@acme.com" });
 *   // result.raw.clientSecret → pass to browser for Stripe Identity embed
 */

import Stripe from "stripe";
import type { KYBProvider, OfficerVerification, OfficerKYCInput } from "../types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface StripeIdentityConfig {
  secretKey: string;
  /** Injected Stripe client — for tests. Production code omits this. */
  client?: Pick<Stripe, "identity">;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeStripeIdentityProvider(config: StripeIdentityConfig): KYBProvider {
  if (!config.secretKey && !config.client) {
    throw new Error("STRIPE_SECRET_KEY_MISSING: secretKey is required");
  }

  const stripe: Pick<Stripe, "identity"> =
    config.client ??
    new Stripe(config.secretKey, { apiVersion: "2026-04-22.dahlia" });

  return {
    // verifyBusiness is Middesk's domain — this provider throws if called.
    verifyBusiness: async () => {
      throw new Error("WRONG_PROVIDER: Use makeMiddeskProvider for verifyBusiness");
    },

    async verifyOfficer(input: OfficerKYCInput): Promise<OfficerVerification> {
      if (!input.email) {
        throw new Error("STRIPE_IDENTITY_INVALID_INPUT: email is required");
      }

      let session: Stripe.Identity.VerificationSession;

      try {
        session = await stripe.identity.verificationSessions.create({
          type: "document",
          metadata: {
            email: input.email,
            ...(input.expectedName ? { expected_name: input.expectedName } : {}),
          },
          options: {
            document: {
              require_id_number:        false,
              require_live_capture:     true,
              require_matching_selfie:  true,
            },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`STRIPE_IDENTITY_SESSION_FAILED: ${message}`);
      }

      if (!session.client_secret) {
        throw new Error(
          `STRIPE_IDENTITY_NO_CLIENT_SECRET: session ${session.id} returned no client_secret`
        );
      }

      // Result is pending — verification completes asynchronously via webhook.
      return {
        ok:                false,   // pending; webhook sets true when verified
        vendorRef:         session.id,
        documentVerified:  false,
        livenessConfirmed: false,
        matchedExpected:   false,
        raw: {
          clientSecret: session.client_secret,
          sessionId:    session.id,
        },
      };
    },
  };
}