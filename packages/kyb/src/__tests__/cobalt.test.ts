/**
 * Cobalt Intelligence adapter (PFL-165). Response bodies follow the
 * examples in Cobalt's public API collection (SoS search, retryId,
 * tinVerification statuses, OFAC matches). No network.
 */

import { describe, it, expect } from "vitest";

import { makeCobaltProvider, mapCobaltResults } from "../providers/cobalt.js";
import type { BusinessLookupInput } from "../types.js";

const INPUT: BusinessLookupInput = {
  legalName: "Example Harbor Supply Co",
  ein:       "00-0294581",
  state:     "UT",
  country:   "US",
  city:      "Salt Lake City",
};

const SOS_OK = {
  status: "Complete",
  statusCode: 200,
  verificationId: "ver_123",
  results: [{
    title: "EXAMPLE HARBOR SUPPLY CO",
    status: "Active",
    normalizedStatus: "Active",
    entityType: "Corporation",
    sosId: "UT-1234567",
    officers: [
      { name: "Ada Lovelace", title: "President", current: "true" },
      { name: "Charles Babbage", title: "", current: "true" },
    ],
  }],
};
const TIN_OK = { name: INPUT.legalName, tin: "000294581", status: "TIN Matched", irsCode: 7, irsReason: "TIN/Name combination matches EIN records" };
const TIN_NO = { name: INPUT.legalName, tin: "000294581", status: "Did Not Match", irsCode: 3, irsReason: "TIN/Name combination does not match IRS records" };
const TIN_PENDING = { status: "Pending", irsReason: "The IRS may be temporarily unavailable", retryId: "Qx7Lm2" };
const OFAC_CLEAN = { name: INPUT.legalName, matchCount: 0, message: "No results found." };
const OFAC_HIT = {
  name: INPUT.legalName, matchCount: 1,
  matches: [{ score: 100, sanction: { id: "sdn-1", name: "EXAMPLE HARBOR SUPPLY", source: "SDN", categories: ["sanction"] } }],
};

type Route = (url: URL) => { status: number; body: unknown };

function fakeFetch(route: Route) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const { status, body } = route(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

function routes(sos: Route, tin: Route, ofac: Route): Route {
  return (url) => {
    if (url.pathname === "/v1/search") return sos(url);
    if (url.pathname === "/tinVerification") return tin(url);
    if (url.pathname === "/ofac") return ofac(url);
    return { status: 404, body: { message: "unknown route" } };
  };
}

const ok = (body: unknown) => () => ({ status: 200, body });
const noSleep = async () => {};

describe("makeCobaltProvider", () => {
  it("requires an API key", () => {
    expect(() => makeCobaltProvider({ apiKey: "" })).toThrow(/COBALT_API_KEY_MISSING/);
  });

  it("calls SoS, TIN and OFAC with x-api-key and maps a clean result to ok=true", async () => {
    const { fn, calls } = fakeFetch(routes(ok(SOS_OK), ok(TIN_OK), ok(OFAC_CLEAN)));
    const r = await makeCobaltProvider({ apiKey: "ck_1", fetch: fn, sleep: noSleep }).verifyBusiness(INPUT);

    expect(r).toMatchObject({ ok: true, pending: false, provider: "cobalt", vendorRef: "UT-1234567" });
    expect(r.flags).toEqual([]);
    expect(r.officers).toEqual([
      { name: "Ada Lovelace", role: "President" },
      { name: "Charles Babbage", role: "officer" },
    ]);

    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.headers["x-api-key"]).toBe("ck_1");
    const sos = calls.find((c) => c.url.pathname === "/v1/search")!.url.searchParams;
    expect(sos.get("searchQuery")).toBe("Example Harbor Supply Co");
    expect(sos.get("state")).toBe("ut");
    expect(sos.get("liveData")).toBe("true");
    expect(sos.get("city")).toBe("Salt Lake City");
    const tin = calls.find((c) => c.url.pathname === "/tinVerification")!.url.searchParams;
    expect(tin.get("tin")).toBe("000294581");
    expect(tin.get("businessName")).toBe("Example Harbor Supply Co");
    expect(calls.find((c) => c.url.pathname === "/ofac")!.url.searchParams.get("score")).toBe("90");
  });

  it("polls a slow SoS search by retryId", async () => {
    let polls = 0;
    const sos: Route = (url) => {
      if (url.searchParams.get("retryId")) {
        polls += 1;
        return polls < 2
          ? { status: 202, body: { status: "Incomplete", statusCode: 202, retryId: "r-1" } }
          : { status: 200, body: SOS_OK };
      }
      return { status: 202, body: { status: "Incomplete", statusCode: 202, retryId: "r-1", message: "ut is taking a longer time" } };
    };
    const { fn } = fakeFetch(routes(sos, ok(TIN_OK), ok(OFAC_CLEAN)));
    const r = await makeCobaltProvider({ apiKey: "k", fetch: fn, sleep: noSleep }).verifyBusiness(INPUT);
    expect(polls).toBe(2);
    expect(r.ok).toBe(true);
  });

  it("returns pending when the SoS search is still incomplete after maxPolls", async () => {
    const incomplete = () => ({ status: 202, body: { status: "Incomplete", statusCode: 202, retryId: "r-9" } });
    const { fn } = fakeFetch(routes(incomplete, ok(TIN_OK), ok(OFAC_CLEAN)));
    const r = await makeCobaltProvider({ apiKey: "k", fetch: fn, sleep: noSleep, maxPolls: 2 }).verifyBusiness(INPUT);
    expect(r).toMatchObject({ ok: false, pending: true, vendorRef: "r-9" });
    expect(r.flags.map((f) => f.type)).toContain("sos_pending");
  });

  it("treats an IRS timeout (500) as pending, not a crash", async () => {
    const { fn } = fakeFetch(routes(ok(SOS_OK), () => ({ status: 500, body: { message: "The IRS API is having troubles." } }), ok(OFAC_CLEAN)));
    const r = await makeCobaltProvider({ apiKey: "k", fetch: fn, sleep: noSleep }).verifyBusiness(INPUT);
    expect(r).toMatchObject({ ok: false, pending: true });
    expect(r.flags.map((f) => f.type)).toEqual(["tin_pending"]);
  });
});

describe("mapCobaltResults", () => {
  it("fails on a TIN mismatch", () => {
    const r = mapCobaltResults({ sos: SOS_OK, tin: TIN_NO, ofac: OFAC_CLEAN, errors: [] });
    expect(r.ok).toBe(false);
    expect(r.flags).toContainEqual(expect.objectContaining({ type: "tin_mismatch", severity: "high" }));
  });

  it("marks a Pending TIN as pending", () => {
    const r = mapCobaltResults({ sos: SOS_OK, tin: TIN_PENDING, ofac: OFAC_CLEAN, errors: [] });
    expect(r).toMatchObject({ ok: false, pending: true });
  });

  it("flags 'Complete' with an invalid-request IRS code as tin_invalid", () => {
    const r = mapCobaltResults({
      sos: SOS_OK, ofac: OFAC_CLEAN, errors: [],
      tin: { status: "Complete", irsCode: 4, irsReason: "Invalid TIN Matching request" },
    });
    expect(r.flags).toContainEqual({ type: "tin_invalid", severity: "high", detail: "Invalid TIN Matching request" });
  });

  it("fails on OFAC matches", () => {
    const r = mapCobaltResults({ sos: SOS_OK, tin: TIN_OK, ofac: OFAC_HIT, errors: [] });
    expect(r.ok).toBe(false);
    expect(r.flags).toContainEqual({ type: "watchlist:SDN", severity: "high", detail: "EXAMPLE HARBOR SUPPLY (score 100)" });
  });

  it("flags no registry match and inactive entities", () => {
    const none = mapCobaltResults({
      sos: { status: "Complete", statusCode: 200, alternativeResults: [{ businessName: "EXAMPLE HARBOUR" }] },
      tin: TIN_OK, ofac: OFAC_CLEAN, errors: [],
    });
    expect(none.flags).toContainEqual(expect.objectContaining({ type: "sos_not_found", severity: "high" }));

    const inactive = mapCobaltResults({
      sos: { ...SOS_OK, results: [{ ...SOS_OK.results[0]!, normalizedStatus: "Inactive" }] },
      tin: TIN_OK, ofac: OFAC_CLEAN, errors: [],
    });
    expect(inactive.ok).toBe(false);
    expect(inactive.flags).toContainEqual(expect.objectContaining({ type: "sos_inactive" }));
  });
});
