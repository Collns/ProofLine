/**
 * @file stripe-identity.test.ts
 * @module apps/functions/src/webhooks/__tests__
 *
 * Tests for makeStripeIdentityWebhookHandler (PFL-013).
 * Includes the E2E acceptance criterion test.
 */

import { describe, it, expect } from "vitest";
import type Stripe from "stripe";

import { makeStripeIdentityWebhookHandler } from "../stripe-identity.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_SESSION_ID    = "vs_test_abc123";
const FAKE_CLIENT_SECRET = "vs_test_abc123_secret_xyz";
const FAKE_WEBHOOK_SECRET = "whsec_test_secret";

// ─── Fake Stripe webhooks client ─────────────────────────────────────────────

function makeFakeStripeWebhooks() {
  return {
    webhooks: {
      constructEvent(payload: Buffer | string, sig: string, secret: string): Stripe.Event {
        if (secret !== FAKE_WEBHOOK_SECRET) {
          throw new Error("No signatures found matching the expected signature for payload");
        }
        if (sig !== "valid-sig") {
          throw new Error("No signatures found matching the expected signature for payload");
        }
        const body = typeof payload === "string" ? payload : payload.toString("utf-8");
        return JSON.parse(body) as Stripe.Event;
      },
    },
  };
}

// ─── Fake Firestore ───────────────────────────────────────────────────────────

function makeFakeFirestore(initialCompany?: { id: string; data: Record<string, unknown> }) {
  const store = new Map<string, Record<string, unknown>>();
  if (initialCompany) store.set(initialCompany.id, { ...initialCompany.data });

  function makeDocRef(id: string) {
    return {
      id,
      data: () => store.get(id) ?? null,
      async update(patch: Record<string, unknown>) {
        const merged = { ...(store.get(id) ?? {}) };
        for (const [key, val] of Object.entries(patch)) {
          if (key.includes(".")) {
            const [top, ...rest] = key.split(".");
            const nested = { ...(merged[top] as Record<string, unknown> ?? {}) };
            nested[rest.join(".")] = val;
            merged[top] = nested;
          } else {
            merged[key] = val;
          }
        }
        store.set(id, merged);
      },
    };
  }

  return {
    _store: store,
    collection: (_name: string) => ({
      where: (_field: string, _op: string, value: unknown) => ({
        limit: (_n: number) => ({
          async get() {
            const matches: Array<{ id: string; data: () => Record<string, unknown>; ref: ReturnType<typeof makeDocRef> }> = [];
            for (const [id, doc] of store.entries()) {
              const enrollment = doc["officerEnrollment"] as Record<string, unknown> | undefined;
              if (enrollment?.["stripeSessionId"] === value) {
                matches.push({ id, data: () => doc, ref: makeDocRef(id) });
              }
            }
            return { empty: matches.length === 0, docs: matches };
          },
        }),
      }),
    }),
  };
}

// ─── Fake req/res ─────────────────────────────────────────────────────────────

function makeFakeReqRes(body: object, headers: Record<string, string> = {}) {
  const req = { body: Buffer.from(JSON.stringify(body)), headers };
  let statusCode = 200;
  let responseBody: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(data: unknown)  { responseBody = data; return res; },
    _status: () => statusCode,
    _body:   () => responseBody,
  };
  return { req, res };
}

// ─── Event factory ────────────────────────────────────────────────────────────

function makeVerifiedEvent(sessionId: string): Stripe.Event {
  return {
    id: "evt_test_001",
    type: "identity.verification_session.verified",
    object: "event",
    data: {
      object: {
        id: sessionId,
        object: "identity.verification_session",
        status: "verified",
      } as unknown as Stripe.Event.Data["object"],
    },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    api_version: "2026-04-22.dahlia",
  } as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeStripeIdentityWebhookHandler", () => {
  it("returns 400 when Stripe-Signature header is missing", async () => {
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     makeFakeFirestore() as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });
    const { req, res } = makeFakeReqRes({});
    await handler(req as never, res as never);
    expect(res._status()).toBe(400);
  });

  it("returns 400 on invalid Stripe signature", async () => {
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     makeFakeFirestore() as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });
    const { req, res } = makeFakeReqRes(makeVerifiedEvent(FAKE_SESSION_ID), {
      "stripe-signature": "invalid-sig",
    });
    await handler(req as never, res as never);
    expect(res._status()).toBe(400);
  });

  it("acks and ignores non-target event types", async () => {
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     makeFakeFirestore() as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });
    const event = { ...makeVerifiedEvent(FAKE_SESSION_ID), type: "payment_intent.created" };
    const { req, res } = makeFakeReqRes(event, { "stripe-signature": "valid-sig" });
    await handler(req as never, res as never);
    expect(res._status()).toBe(200);
    expect((res._body() as { ignored: boolean }).ignored).toBe(true);
  });

  it("acks and ignores when no company matches the sessionId", async () => {
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     makeFakeFirestore() as never,   // empty
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });
    const { req, res } = makeFakeReqRes(makeVerifiedEvent(FAKE_SESSION_ID), {
      "stripe-signature": "valid-sig",
    });
    await handler(req as never, res as never);
    expect(res._status()).toBe(200);
    expect((res._body() as { ignored: boolean }).ignored).toBe(true);
  });

  it("updates Firestore and advances status to pending_finalize", async () => {
    const db = makeFakeFirestore({
      id:   "company-acme",
      data: {
        onboardingStatus:  "pending_kyc",
        officerEnrollment: {
          stripeSessionId:    FAKE_SESSION_ID,
          stripeClientSecret: FAKE_CLIENT_SECRET,
          officerEmail:       "sarah@acme.com",
        },
      },
    });
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     db as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });

    const { req, res } = makeFakeReqRes(makeVerifiedEvent(FAKE_SESSION_ID), {
      "stripe-signature": "valid-sig",
    });
    await handler(req as never, res as never);

    expect(res._status()).toBe(200);
    expect((res._body() as { companyId: string }).companyId).toBe("company-acme");

    const updated = db._store.get("company-acme");
    expect(updated?.["onboardingStatus"]).toBe("pending_finalize");
    const enrollment = updated?.["officerEnrollment"] as Record<string, unknown>;
    expect(enrollment?.["status"]).toBe("verified");
    expect(enrollment?.["verifiedAt"]).toBeTruthy();
  });

  it("is idempotent — skips already-verified sessions", async () => {
    const db = makeFakeFirestore({
      id:   "company-acme",
      data: {
        onboardingStatus:  "pending_finalize",
        officerEnrollment: {
          stripeSessionId: FAKE_SESSION_ID,
          verifiedAt:      "2026-05-10T10:00:00Z",
          status:          "verified",
        },
      },
    });
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     db as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });

    const { req, res } = makeFakeReqRes(makeVerifiedEvent(FAKE_SESSION_ID), {
      "stripe-signature": "valid-sig",
    });
    await handler(req as never, res as never);

    expect(res._status()).toBe(200);
    expect((res._body() as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);
  });

  it("E2E acceptance: webhook fires → Firestore updated to pending_finalize", async () => {
    const db = makeFakeFirestore({
      id:   "company-acme",
      data: {
        onboardingStatus:  "pending_kyc",
        officerEnrollment: {
          stripeSessionId:    FAKE_SESSION_ID,
          stripeClientSecret: FAKE_CLIENT_SECRET,
          officerEmail:       "sarah@acmetitle.com",
        },
      },
    });
    const handler = makeStripeIdentityWebhookHandler({
      stripe:        makeFakeStripeWebhooks() as never,
      firestore:     db as never,
      webhookSecret: FAKE_WEBHOOK_SECRET,
    });

    const { req, res } = makeFakeReqRes(makeVerifiedEvent(FAKE_SESSION_ID), {
      "stripe-signature": "valid-sig",
    });
    await handler(req as never, res as never);

    expect(res._status()).toBe(200);
    const company = db._store.get("company-acme");
    expect(company?.["onboardingStatus"]).toBe("pending_finalize");
    const enrollment = company?.["officerEnrollment"] as Record<string, unknown>;
    expect(enrollment?.["status"]).toBe("verified");
    expect(enrollment?.["verifiedAt"]).toBeTruthy();
  });
});