/**
 * PFL-162 — Baselayer KYB webhook: Svix signature, late IRS results and
 * status guards.
 */

import * as crypto from "node:crypto";

import { describe, it, expect, vi } from "vitest";
import type * as express from "express";

import { makeBaselayerWebhookHandler } from "../baselayer.js";

const SECRET_BYTES = Buffer.from("baselayer-test-signing-secret-32b");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function sign(body: string, id = "msg_1", ts = NOW_S, key = SECRET_BYTES) {
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

function fakeFirestore(company: Record<string, unknown> | null) {
  const state = { data: company ? { ...company } : null };
  const update = vi.fn(async (patch: Record<string, unknown>) => { state.data = { ...state.data, ...patch }; });
  const where = vi.fn(() => ({
    limit: () => ({
      get: async () => (state.data
        ? { empty: false, docs: [{ id: "co-1", data: () => state.data, ref: { update } }] }
        : { empty: true, docs: [] }),
    }),
  }));
  return { firestore: { collection: () => ({ where }) } as never, state, update, where };
}

function call(handler: ReturnType<typeof makeBaselayerWebhookHandler>, body: string, headers: Record<string, string>) {
  const res = { statusCode: 0, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; } };
  const req = { body: Buffer.from(body), headers } as unknown as express.Request;
  return handler(req, res as unknown as express.Response).then(() => res);
}

const completedSearch = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  id: "bl_search_1", state: "COMPLETED", verified: true, tin_matched: true, watchlist_hits: [],
  business_name_match: "EXACT", __event__: { type: "BusinessSearch.updated" }, ...overrides,
});

const pendingCompany = {
  onboardingStatus: "pending_kyb",
  kybResult: { ok: false, pending: true, vendorRef: "bl_search_1", provider: "baselayer", flags: [], officers: [], verifiedAt: 1 },
};

describe("Baselayer webhook", () => {
  it("rejects a bad or missing signature", async () => {
    const fs = fakeFirestore(pendingCompany);
    const h = makeBaselayerWebhookHandler({ firestore: fs.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    const body = completedSearch();
    expect((await call(h, body, {})).statusCode).toBe(400);
    expect((await call(h, body, sign(body, "msg_1", NOW_S, Buffer.from("wrong-key")))).statusCode).toBe(400);
    expect((await call(h, body, sign(body, "msg_1", NOW_S - 3600))).statusCode).toBe(400); // replay window
    expect(fs.update).not.toHaveBeenCalled();
  });

  it("applies a late TIN match: pending_kyb → pending_kyc with provider label", async () => {
    const fs = fakeFirestore(pendingCompany);
    const h = makeBaselayerWebhookHandler({ firestore: fs.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    const body = completedSearch();
    const res = await call(h, body, sign(body));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ companyId: "co-1", status: "pending_kyc" });
    expect(fs.where).toHaveBeenCalledWith("kybResult.vendorRef", "==", "bl_search_1");
    expect(fs.state.data).toMatchObject({
      onboardingStatus: "pending_kyc",
      kybResult: { ok: true, pending: false, provider: "baselayer", vendorRef: "bl_search_1", verifiedAt: NOW_MS },
    });
  });

  it("rejects on a final failure and keeps waiting while still pending", async () => {
    const mismatch = completedSearch({ tin_matched: false });
    const fs1 = fakeFirestore(pendingCompany);
    const h1 = makeBaselayerWebhookHandler({ firestore: fs1.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    expect((await call(h1, mismatch, sign(mismatch))).body).toMatchObject({ status: "rejected" });
    expect((fs1.state.data as { kybResult: { flags: { type: string }[] } }).kybResult.flags.map((f) => f.type))
      .toContain("tin_mismatch");

    const stillPending = completedSearch({ tin_matched: null });
    const fs2 = fakeFirestore(pendingCompany);
    const h2 = makeBaselayerWebhookHandler({ firestore: fs2.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    expect((await call(h2, stillPending, sign(stillPending))).body).toMatchObject({ status: "pending_kyb" });
    expect(fs2.state.data).toMatchObject({ kybResult: { pending: true } });
  });

  it("ignores unknown searches, other events and companies past KYB", async () => {
    const body = completedSearch();
    const none = fakeFirestore(null);
    const h0 = makeBaselayerWebhookHandler({ firestore: none.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    expect((await call(h0, body, sign(body))).body).toMatchObject({ ignored: true });

    const other = completedSearch({ __event__: { type: "Order.completed" } });
    const fs = fakeFirestore(pendingCompany);
    const h1 = makeBaselayerWebhookHandler({ firestore: fs.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    expect((await call(h1, other, sign(other))).body).toMatchObject({ ignored: true });

    const done = fakeFirestore({ ...pendingCompany, onboardingStatus: "verified" });
    const h2 = makeBaselayerWebhookHandler({ firestore: done.firestore, webhookSecret: SECRET, now: () => NOW_MS });
    expect((await call(h2, body, sign(body))).body).toMatchObject({ skipped: true });
    expect(done.update).not.toHaveBeenCalled();
    expect(fs.update).not.toHaveBeenCalled();
  });
});
