/**
 * Baselayer adapter (PFL-161). Response shapes follow the documented
 * Business Search examples at docs.baselayer.com (quickstart + IRS-outage
 * webhook guide). No network: a fake fetch records requests and returns
 * canned responses.
 */

import * as crypto from "node:crypto";
import { describe, it, expect } from "vitest";

import {
  makeBaselayerProvider,
  mapBaselayerSearch,
  verifyBaselayerWebhook,
  parseBaselayerWebhook,
  type BaselayerSearch,
} from "../providers/baselayer.js";
import type { BusinessLookupInput } from "../types.js";

const INPUT: BusinessLookupInput = {
  legalName:    "Howard Concrete Pumping Co Inc",
  ein:          "98-7654321",
  state:        "PA",
  country:      "US",
  street:       "2327 Hill Church Houston Rd",
  city:         "Canonsburg",
  zip:          "15317",
  officerNames: ["Frank Howard Jr"],
};

// Trimmed from the documented COMPLETED example.
function completed(overrides: Partial<BaselayerSearch> = {}): BaselayerSearch {
  return {
    id:                     "e3166643-8578-4fff-aafc-6b5602dfb404",
    state:                  "COMPLETED",
    verified:               true,
    tin_matched:            true,
    business_name_match:    "EXACT",
    business_address_match: "EXACT",
    business_officer_match: "EXACT",
    watchlist_hits: [
      { code: "IEO",  name: "IRS Exempt Organizations List", count: 0, details: [] },
      { code: "OFAC", name: "Department of Treasury, Office of Foreign Assets Control", count: 0, details: [] },
    ],
    scores:   [{ type: "kyb", score: 83.0, rating: "B" }, { type: "risk", score: 93.0, rating: "A" }],
    warnings: [],
    business: {
      id:   "1e78e99d-d515-435a-a0b5-dc7899f55f9c",
      name: "HOWARD CONCRETE PUMPING CO., INC.",
      registrations: [
        {
          state: "PA", status: "active",
          officers: [{ name: "FRANK HOWARD JR", titles: ["PRESIDENT"] }, { name: "MARY HOWARD", titles: ["SECRETARY"] }],
        },
        { state: "OH", status: "active", officers: [{ name: "Frank Howard Jr", titles: ["DIRECTOR"] }] },
      ],
    },
    ...overrides,
  };
}

interface Call { url: string; init: RequestInit }

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

describe("makeBaselayerProvider", () => {
  it("requires an API key", () => {
    expect(() => makeBaselayerProvider({ apiKey: "" })).toThrow(/BASELAYER_API_KEY_MISSING/);
  });

  it("POSTs /searches with the key, Prefer: wait and the mapped body", async () => {
    const { fn, calls } = fakeFetch(201, completed());
    const provider = makeBaselayerProvider({ apiKey: "sk_test_1", waitSeconds: 500, fetch: fn });
    await provider.verifyBusiness(INPUT);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.baselayer.com/searches");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["X-API-Key"]).toBe("sk_test_1");
    expect(h["Prefer"]).toBe("wait=90"); // capped at the documented max
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name:          "Howard Concrete Pumping Co Inc",
      address:       "2327 Hill Church Houston Rd, Canonsburg, PA 15317",
      tin:           "987654321",
      officer_names: ["Frank Howard Jr"],
    });
  });

  it("maps a verified, TIN-matched, clean search to ok=true with deduped officers", async () => {
    const { fn } = fakeFetch(201, completed());
    const r = await makeBaselayerProvider({ apiKey: "k", fetch: fn }).verifyBusiness(INPUT);
    expect(r.ok).toBe(true);
    expect(r.pending).toBe(false);
    expect(r.provider).toBe("baselayer");
    expect(r.vendorRef).toBe("e3166643-8578-4fff-aafc-6b5602dfb404");
    expect(r.flags).toEqual([]);
    expect(r.officers).toEqual([
      { name: "FRANK HOWARD JR", role: "PRESIDENT" },
      { name: "MARY HOWARD", role: "SECRETARY" },
    ]);
  });

  it("returns a pending result on 202 and takes the id from X-Resource-Id", async () => {
    const { fn } = fakeFetch(202, { state: "PENDING" }, { "X-Resource-Id": "srch_123" });
    const r = await makeBaselayerProvider({ apiKey: "k", fetch: fn }).verifyBusiness(INPUT);
    expect(r).toMatchObject({ ok: false, pending: true, vendorRef: "srch_123" });
    expect(r.flags.map((f) => f.type)).toContain("search_pending");
  });

  it("throws on validation errors instead of returning a result", async () => {
    const { fn } = fakeFetch(422, { detail: [{ loc: ["body", "address"], msg: "field required" }] });
    await expect(makeBaselayerProvider({ apiKey: "k", fetch: fn }).verifyBusiness(INPUT))
      .rejects.toThrow(/BASELAYER_HTTP_422/);
  });
});

describe("mapBaselayerSearch", () => {
  it("flags a TIN mismatch as high and fails", () => {
    const r = mapBaselayerSearch(completed({ tin_matched: false }));
    expect(r.ok).toBe(false);
    expect(r.flags).toContainEqual(expect.objectContaining({ type: "tin_mismatch", severity: "high" }));
  });

  it("treats an IRS outage (tin_matched null + warning string) as pending", () => {
    const r = mapBaselayerSearch(completed({ tin_matched: null, warnings: "IRS Validation is unavailable." }));
    expect(r.ok).toBe(false);
    expect(r.pending).toBe(true);
    expect(r.flags.map((f) => f.type)).toEqual(["warning", "tin_pending"]);
  });

  it("accepts warnings as an array too", () => {
    const r = mapBaselayerSearch(completed({ warnings: ["IRS Validation is unavailable."] }));
    expect(r.flags).toContainEqual({ type: "warning", severity: "medium", detail: "IRS Validation is unavailable." });
  });

  it("fails on any watchlist list with hits", () => {
    const r = mapBaselayerSearch(completed({
      watchlist_hits: [{ code: "OFAC", name: "OFAC", count: 1, details: [{}] }],
    }));
    expect(r.ok).toBe(false);
    expect(r.flags).toContainEqual(expect.objectContaining({ type: "watchlist:OFAC", severity: "high" }));
  });

  it("flags name / address mismatches and unverified results", () => {
    const r = mapBaselayerSearch(completed({
      verified: false, business_name_match: "NO_MATCH", business_address_match: "NO_MATCH",
    }));
    expect(r.ok).toBe(false);
    expect(r.flags.map((f) => f.type)).toEqual(["name_mismatch", "address_mismatch", "not_verified"]);
  });

  it("reports a failed search", () => {
    const r = mapBaselayerSearch({ id: "s1", state: "FAILED", error: "upstream error" });
    expect(r.ok).toBe(false);
    expect(r.flags).toContainEqual({ type: "search_failed", severity: "high", detail: "upstream error" });
  });

  it("prefers business_officers when present", () => {
    const r = mapBaselayerSearch(completed({
      business: { business_officers: [{ name: "Jane Roe", titles: ["CEO"] }], registrations: [] },
    }));
    expect(r.officers).toEqual([{ name: "Jane Roe", role: "CEO" }]);
  });
});

describe("webhooks", () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString("base64")}`;

  function sign(id: string, ts: number, body: string): string {
    return crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
  }

  it("verifies a Svix signature and rejects tampering or stale timestamps", () => {
    const body = JSON.stringify({ id: "s1", state: "COMPLETED", tin_matched: true });
    const ts = 1_800_000_000;
    const headers = { "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": `v1,${sign("msg_1", ts, body)}` };

    expect(verifyBaselayerWebhook(body, headers, secret, ts + 10)).toBe(true);
    expect(verifyBaselayerWebhook(body.replace("true", "false"), headers, secret, ts + 10)).toBe(false);
    expect(verifyBaselayerWebhook(body, headers, secret, ts + 3600)).toBe(false);
    expect(verifyBaselayerWebhook(body, { ...headers, "svix-signature": "v1,AAAA" }, secret, ts)).toBe(false);
  });

  it("parses BusinessSearch.updated into a final result", () => {
    const { event, result } = parseBaselayerWebhook({
      ...completed({ tin_matched: true, warnings: [] }),
      __event__: { type: "BusinessSearch.updated", origin: "api" },
    });
    expect(event).toBe("BusinessSearch.updated");
    expect(result.ok).toBe(true);
    expect(result.pending).toBe(false);
  });
});
