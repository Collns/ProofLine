/**
 * @file baselayer.ts
 * @module apps/functions/src/webhooks
 *
 * POST /webhooks/baselayer — Baselayer KYB webhook (PFL-162).
 *
 * Baselayer finishes some searches after POST /searches returns, most often
 * when the IRS TIN check was unavailable (tin_matched === null). It then
 * sends BusinessSearch.completed / .failed / .updated through Svix.
 *
 *   1. Verify the Svix signature over the raw body (express.raw required).
 *   2. Map the search with the adapter's mapping (same rules as the
 *      synchronous path in kyb.handler.ts).
 *   3. Find the company whose kybResult.vendorRef is this search id.
 *   4. Only while the company is still pending_kyb: replace kybResult and
 *      advance to pending_kyc (ok), reject (final failure) or keep waiting
 *      (still pending).
 *
 * Unknown searches and companies past the KYB step are acknowledged with
 * 200 so Svix stops retrying.
 */

import type * as express from "express";
import {
  parseBaselayerWebhook,
  verifyBaselayerWebhook,
  type BaselayerSearch,
} from "@proofline/kyb/providers/baselayer.js";

const HANDLED_EVENTS = new Set([
  "BusinessSearch.completed",
  "BusinessSearch.failed",
  "BusinessSearch.updated",
]);

export interface BaselayerWebhookDeps {
  firestore:     Pick<FirebaseFirestore.Firestore, "collection">;
  webhookSecret: string;
  now?:          () => number;
}

function header(req: express.Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function makeBaselayerWebhookHandler(deps: BaselayerWebhookDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function baselayerWebhookHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // ── 1. Signature ─────────────────────────────────────────────────────────
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : undefined;
    if (rawBody === undefined) {
      res.status(400).json({ error: "Raw body required" });
      return;
    }
    const valid = verifyBaselayerWebhook(
      rawBody,
      {
        "svix-id":        header(req, "svix-id"),
        "svix-timestamp": header(req, "svix-timestamp"),
        "svix-signature": header(req, "svix-signature"),
      },
      deps.webhookSecret,
      Math.floor(now() / 1000),
    );
    if (!valid) {
      res.status(400).json({ error: "Webhook signature invalid" });
      return;
    }

    let payload: BaselayerSearch;
    try {
      payload = JSON.parse(rawBody) as BaselayerSearch;
    } catch {
      res.status(400).json({ error: "Body is not JSON" });
      return;
    }

    // ── 2. Event + mapping ───────────────────────────────────────────────────
    const { event, result } = parseBaselayerWebhook(payload);
    if (!event || !HANDLED_EVENTS.has(event) || !payload.id) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    // ── 3. Company ───────────────────────────────────────────────────────────
    const snapshot = await deps.firestore
      .collection("companies")
      .where("kybResult.vendorRef", "==", payload.id)
      .limit(1)
      .get();
    if (snapshot.empty) {
      console.warn(`[baselayer-webhook] No company for search ${payload.id}; ignoring.`);
      res.status(200).json({ received: true, ignored: true });
      return;
    }
    const doc = snapshot.docs[0]!;
    const company = doc.data() as { onboardingStatus?: string; kybResult?: { verifiedAt?: number } };

    if (company.onboardingStatus !== "pending_kyb") {
      res.status(200).json({ received: true, skipped: true, reason: "not_pending_kyb" });
      return;
    }

    // ── 4. Apply ─────────────────────────────────────────────────────────────
    const pending = !result.ok && result.pending === true;
    const status = result.ok ? "pending_kyc" : pending ? "pending_kyb" : "rejected";
    const t = now();

    await doc.ref.update({
      kybResult: {
        ok:         result.ok,
        vendorRef:  result.vendorRef,
        flags:      result.flags,
        officers:   result.officers,
        provider:   "baselayer",
        pending,
        verifiedAt: t,
      },
      onboardingStatus: status,
      updatedAt:        t,
    });

    console.info(`[baselayer-webhook] ${event} for company ${doc.id}: status ${status}`);
    res.status(200).json({ received: true, companyId: doc.id, status });
  };
}
