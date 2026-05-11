/**
 * @file stripe-identity.ts
 * @module apps/functions/src/webhooks
 *
 * Stripe Identity webhook handler.
 *
 * Handles: identity.verification_session.verified
 *
 * Per TDD §7.2 and PFL-013:
 *   When Stripe fires identity.verification_session.verified, this handler:
 *     1. Validates the Stripe-Signature header (HMAC, prevents spoofing).
 *     2. Finds the company doc that owns this session via
 *        officerEnrollment.stripeSessionId.
 *     3. Updates officerEnrollment.verifiedAt + advances onboardingStatus
 *        to "pending_finalize".
 *
 * Mount in apps/functions/src/index.ts:
 *   app.post(
 *     "/webhooks/stripe-identity",
 *     express.raw({ type: "application/json" }),   // ← raw body required for sig check
 *     stripeIdentityWebhookHandler
 *   );
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY        — used to construct Stripe client
 *   STRIPE_IDENTITY_WEBHOOK_SECRET — whsec_* from Stripe dashboard
 */

import type * as express from "express";
import Stripe from "stripe";
import * as admin from "firebase-admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StripeWebhookDeps {
  stripe: Pick<Stripe, "webhooks">;
  firestore: FirebaseFirestore.Firestore;
  webhookSecret: string;
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function makeStripeIdentityWebhookHandler(deps: StripeWebhookDeps) {
  return async function stripeIdentityWebhookHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    // ── 1. Validate Stripe signature ─────────────────────────────────────────

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).json({ error: "Missing Stripe-Signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      // req.body must be the raw Buffer (express.raw middleware required)
      event = deps.stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        deps.webhookSecret
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[stripe-webhook] Signature verification failed:", message);
      res.status(400).json({ error: `Webhook signature invalid: ${message}` });
      return;
    }

    // ── 2. Only handle the event type we care about ───────────────────────────

    if (event.type !== "identity.verification_session.verified") {
      // Acknowledge other events without processing (Stripe expects 2xx)
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const session = event.data.object as Stripe.Identity.VerificationSession;
    const sessionId = session.id;

    console.info(`[stripe-webhook] Processing verified session: ${sessionId}`);

    // ── 3. Find the company that owns this session ────────────────────────────

    const companiesRef = deps.firestore.collection("companies");
    const snapshot = await companiesRef
      .where("officerEnrollment.stripeSessionId", "==", sessionId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Could be a session from a different environment — log and ack.
      console.warn(
        `[stripe-webhook] No company found for stripeSessionId=${sessionId}. Ignoring.`
      );
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const companyDoc = snapshot.docs[0];
    const companyId  = companyDoc.id;
    const company    = companyDoc.data();

    // Guard: idempotency — don't double-process
    if (company.officerEnrollment?.verifiedAt) {
      console.info(
        `[stripe-webhook] Session ${sessionId} already processed for company ${companyId}. Skipping.`
      );
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }

    // Guard: only advance if in the correct state
    if (!["pending_kyc", "pending_finalize"].includes(company.onboardingStatus)) {
      console.warn(
        `[stripe-webhook] Company ${companyId} in unexpected status=${company.onboardingStatus} for session ${sessionId}`
      );
      res.status(200).json({ received: true, skipped: true, reason: "unexpected_status" });
      return;
    }

    // ── 4. Update Firestore ───────────────────────────────────────────────────

    await companyDoc.ref.update({
      "officerEnrollment.verifiedAt":      admin.firestore.FieldValue.serverTimestamp(),
      "officerEnrollment.stripeSessionId": sessionId,
      "officerEnrollment.status":          "verified",
      onboardingStatus:                    "pending_finalize",
      updatedAt:                           admin.firestore.FieldValue.serverTimestamp(),
    });

    console.info(
      `[stripe-webhook] Officer verified for company ${companyId}. Status → pending_finalize.`
    );

    res.status(200).json({ received: true, companyId });
  };
}

// ─── Convenience factory using env vars ───────────────────────────────────────

/**
 * Creates the webhook handler wired to real Stripe + Firestore.
 * Call once at app startup; mount the result as an Express route.
 */
export function createStripeIdentityWebhookHandler() {
  const secretKey     = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;

  if (!secretKey)     throw new Error("STRIPE_SECRET_KEY env var is required");
  if (!webhookSecret) throw new Error("STRIPE_IDENTITY_WEBHOOK_SECRET env var is required");

  const stripe = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });

  return makeStripeIdentityWebhookHandler({
    stripe,
    firestore:     admin.firestore(),
    webhookSecret,
  });
}