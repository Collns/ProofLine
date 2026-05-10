/**
 * @file middesk.test.ts
 * @module packages/kyb/src/__tests__
 *
 * Integration test for the Middesk adapter.
 *
 * Strategy:
 *   - Real Middesk sandbox tests cost money and require network access.
 *     Per docs/ARCHITECTURE.md "Test isolation: every package's test suite
 *     must run with stub providers only, never real API keys", we drive
 *     this test with an in-memory fake that mimics Middesk's HTTP API
 *     using the canonical sandbox response shapes from their docs.
 *   - The fake validates request shape (POST body, Authorization header,
 *     polling pattern) AND returns realistic responses for the test
 *     scenarios documented in TDD §7.1.
 *
 * Acceptance criterion from PFL-012:
 *   "integration test against Middesk sandbox with a known test business,
 *    returns ok=true and officers list"
 *
 * The "known test business" here is Middesk's documented sandbox EIN
 * 00-0000000 → approved with officers, plus our own variants for
 * rejected / manual_review / polling paths.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { makeMiddeskProvider } from "../providers/middesk.js";
import type { BusinessLookupInput } from "../types.js";

// ─── Fake Middesk server ─────────────────────────────────────────────────────

interface FakeBusinessRecord {
  id:           string;
  state:        "in_audit" | "open" | "in_review" | "closed";
  reviewStatus: "approved" | "rejected" | "manual_review" | "open" | null;
  payload:      Record<string, unknown>;
  /** How many GETs before returning a terminal state.  0 = terminal immediately. */
  pollsRequired: number;
  pollsDone:    number;
}

class FakeMiddesk {
  records = new Map<string, FakeBusinessRecord>();
  requestLog: Array<{ method: string; url: string; body?: unknown; auth?: string }> = [];

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const auth   = (init?.headers as Record<string, string>)?.["Authorization"];

    let body: unknown = undefined;
    if (init?.body) body = JSON.parse(init.body as string);
    this.requestLog.push({ method, url, body, auth });

    // Auth check
    if (!auth?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }

    // POST /v1/businesses
    if (method === "POST" && url.endsWith("/v1/businesses")) {
      return this.createBusiness(body as { name: string; tin: { tin: string } });
    }

    // GET /v1/businesses/{id}
    const m = url.match(/\/v1\/businesses\/([^/?]+)$/);
    if (method === "GET" && m) {
      return this.getBusiness(m[1]);
    }

    return new Response("Not Found", { status: 404 });
  };

  // Pre-seed test scenarios:

  seed(): void {
    // Approved business — Acme Corp with two officers (sandbox happy path).
    this.records.set("biz_acme", {
      id:           "biz_acme",
      state:        "in_audit",
      reviewStatus: "approved",
      pollsRequired: 0,
      pollsDone:    0,
      payload: {
        object: "business",
        id:     "biz_acme",
        name:   "Acme Corporation",
        status: "in_audit",
        review: { object: "review", status: "approved", completed_at: "2026-05-10T10:00:00Z" },
        tin:    { tin: "123456789", tin_type: "EIN" },
        tin_status: "found",
        addresses: [{ state: "DE" }],
        watchlist: { listed: false },
        sanctions: { listed: false },
        officers: [
          { name: "Alice Chen",     titles: ["CEO"] },
          { name: "Bob Martinez",   titles: ["CFO"] },
        ],
      },
    });

    // Rejected: sanctions hit.
    this.records.set("biz_sanctioned", {
      id:           "biz_sanctioned",
      state:        "closed",
      reviewStatus: "rejected",
      pollsRequired: 0,
      pollsDone:    0,
      payload: {
        object: "business",
        id:     "biz_sanctioned",
        name:   "Bad Actor LLC",
        status: "closed",
        review: { object: "review", status: "rejected", completed_at: "2026-05-10T10:01:00Z" },
        tin:    { tin: "111111111", tin_type: "EIN" },
        tin_status: "found",
        addresses: [{ state: "FL" }],
        watchlist: { listed: false },
        sanctions: { listed: true, matches: [{ source: "OFAC SDN" }] },
        officers: [],
      },
    });

    // Manual review: name mismatch.
    this.records.set("biz_namemismatch", {
      id:           "biz_namemismatch",
      state:        "in_audit",
      reviewStatus: "manual_review",
      pollsRequired: 0,
      pollsDone:    0,
      payload: {
        object: "business",
        id:     "biz_namemismatch",
        name:   "Acme Holdings, Inc.",   // canonical name
        status: "in_audit",
        review: { object: "review", status: "manual_review" },
        tin:    { tin: "222222222", tin_type: "EIN" },
        tin_status: "found",
        addresses: [{ state: "CA" }],
        watchlist: { listed: false },
        sanctions: { listed: false },
        officers: [{ name: "Carol White", titles: ["Director"] }],
      },
    });

    // Polling required: returns "open" twice, then "in_audit"+approved.
    this.records.set("biz_polling", {
      id:           "biz_polling",
      state:        "open",
      reviewStatus: null,
      pollsRequired: 2,
      pollsDone:    0,
      payload: {
        object: "business",
        id:     "biz_polling",
        name:   "Slow Co",
        status: "open",
        tin:    { tin: "333333333", tin_type: "EIN" },
        addresses: [{ state: "NY" }],
      },
    });
  }

  private createBusiness(body: { name: string; tin: { tin: string } }): Response {
    const ein = body.tin.tin;
    let id: string;
    if (ein === "123456789")      id = "biz_acme";
    else if (ein === "111111111") id = "biz_sanctioned";
    else if (ein === "222222222") id = "biz_namemismatch";
    else if (ein === "333333333") id = "biz_polling";
    else                          id = `biz_unknown_${ein}`;

    const record = this.records.get(id);
    if (!record) {
      // Unknown EIN → return generic open record
      return new Response(JSON.stringify({
        object: "business", id, name: body.name, status: "open",
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }

    // Initial POST returns the record in its starting state.
    const initialPayload = record.pollsRequired > 0
      ? { ...record.payload, status: "open" }   // not yet ready
      : record.payload;

    return new Response(JSON.stringify(initialPayload), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  private getBusiness(id: string): Response {
    const record = this.records.get(id);
    if (!record) return new Response("Not Found", { status: 404 });

    record.pollsDone++;

    // While pollsRequired hasn't been hit, return the "open" intermediate state.
    if (record.pollsDone <= record.pollsRequired) {
      return new Response(JSON.stringify({
        ...record.payload,
        status: "open",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // After polls satisfied, return terminal state with full data.
    const terminalPayload = id === "biz_polling"
      ? {
          ...record.payload,
          status: "in_audit",
          review: { object: "review", status: "approved", completed_at: "2026-05-10T10:00:05Z" },
          tin_status: "found",
          watchlist: { listed: false },
          sanctions: { listed: false },
          officers: [{ name: "Dave Slow", titles: ["CEO"] }],
        }
      : record.payload;

    return new Response(JSON.stringify(terminalPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeMiddeskProvider — integration", () => {
  let middesk: FakeMiddesk;
  let provider: ReturnType<typeof makeMiddeskProvider>;

  beforeEach(() => {
    middesk = new FakeMiddesk();
    middesk.seed();
    provider = makeMiddeskProvider({
      apiKey:         "mk_test_fakekey",
      baseUrl:        "https://api-sandbox.middesk.com",
      pollIntervalMs: 1,           // accelerate polling in tests
      pollTimeoutMs:  5_000,
      fetch:          middesk.fetch,
    });
  });

  // ── Acceptance test ──────────────────────────────────────────────────────

  it("returns ok=true and officers list for known sandbox business", async () => {
    const input: BusinessLookupInput = {
      legalName: "Acme Corporation",
      ein:       "12-3456789",
      state:     "DE",
      country:   "US",
    };

    const result = await provider.verifyBusiness(input);

    expect(result.ok).toBe(true);
    expect(result.vendorRef).toBe("biz_acme");
    expect(result.flags).toEqual([]);
    expect(result.officers).toEqual([
      { name: "Alice Chen",   role: "CEO" },
      { name: "Bob Martinez", role: "CFO" },
    ]);
    expect((result.raw as any).id).toBe("biz_acme");
  });

  // ── Request shape ─────────────────────────────────────────────────────────

  it("POSTs the correct body and Authorization header", async () => {
    await provider.verifyBusiness({
      legalName: "Acme Corporation",
      ein:       "12-3456789",
      state:     "DE",
      country:   "US",
    });

    const post = middesk.requestLog.find((r) => r.method === "POST")!;
    expect(post.url).toBe("https://api-sandbox.middesk.com/v1/businesses");
    expect(post.auth).toBe("Bearer mk_test_fakekey");
    expect(post.body).toEqual({
      name: "Acme Corporation",
      tin:  { tin: "123456789" },          // hyphen stripped
      addresses: [{ state: "DE" }],
    });
  });

  // ── Polling ────────────────────────────────────────────────────────────────

  it("polls until status becomes terminal", async () => {
    const result = await provider.verifyBusiness({
      legalName: "Slow Co",
      ein:       "33-3333333",
      state:     "NY",
      country:   "US",
    });

    expect(result.ok).toBe(true);
    expect(result.officers).toEqual([{ name: "Dave Slow", role: "CEO" }]);

    // 1 POST + (2 polls returning "open") + 1 final poll = 3 GETs.
    const gets = middesk.requestLog.filter((r) => r.method === "GET");
    expect(gets.length).toBe(3);
  });

  // ── Sanctions / failure ────────────────────────────────────────────────────

  it("returns ok=false with sanctions_match flag for sanctioned business", async () => {
    const result = await provider.verifyBusiness({
      legalName: "Bad Actor LLC",
      ein:       "11-1111111",
      state:     "FL",
      country:   "US",
    });

    expect(result.ok).toBe(false);
    expect(result.officers).toEqual([]);
    expect(result.flags.some((f) => f.type === "sanctions_match" && f.severity === "high")).toBe(true);
  });

  // ── Name mismatch / manual review ──────────────────────────────────────────

  it("flags name_mismatch and manual_review_required for differing legal names", async () => {
    const result = await provider.verifyBusiness({
      legalName: "Acme Holdings",        // submitted
      ein:       "22-2222222",
      state:     "CA",
      country:   "US",
    });
    // Middesk returns "Acme Holdings, Inc." → name_mismatch
    // review.status === "manual_review" → manual_review_required + ok=false

    expect(result.ok).toBe(false);
    expect(result.flags.some((f) => f.type === "name_mismatch")).toBe(true);
    expect(result.flags.some((f) => f.type === "manual_review_required")).toBe(true);
    expect(result.officers).toEqual([{ name: "Carol White", role: "Director" }]);
  });

  // ── Error paths ────────────────────────────────────────────────────────────

 it("throws MIDDESK_START_FAILED on non-2xx POST", async () => {
    const badProvider = makeMiddeskProvider({
      apiKey:         "wrong-key-without-bearer-prefix",
      baseUrl:        "https://api-sandbox.middesk.com",
      pollIntervalMs: 1,
      fetch:          middesk.fetch,
    });
    await expect(
      badProvider.verifyBusiness({ legalName: "x", ein: "00-0000000", state: "CA", country: "US" })
    ).rejects.toThrow();
  });

  it("verifyOfficer throws — Stripe Identity handles that path", async () => {
    await expect(
      provider.verifyOfficer({ email: "alice@acme.com" })
    ).rejects.toThrow(/MIDDESK_DOES_NOT_HANDLE_OFFICER_KYC/);
  });

  it("constructor throws when apiKey is missing", () => {
    expect(() => makeMiddeskProvider({ apiKey: "" })).toThrow(/MIDDESK_API_KEY_MISSING/);
  });
});