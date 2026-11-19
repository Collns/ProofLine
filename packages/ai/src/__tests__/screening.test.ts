/**
 * PFL-028 — memo screening: Gemini request/response handling (no network),
 * the heuristic baseline, and the never-throw wrapper.
 */

import { describe, it, expect, vi } from "vitest";

import {
  makeGeminiScreener,
  parseScreeningOutput,
  ScreeningError,
  makeHeuristicScreener,
  makeNoopScreener,
  screenSafely,
  GEMINI_DEFAULT_MODEL,
} from "../index.js";
import type { ScreeningInput } from "../index.js";

const BEC: ScreeningInput = {
  subject:          "URGENT: updated wire instructions",
  body:             "Hi, our bank details have changed. Please use this account today before 3pm. " +
                    "This is confidential, do not call the office to confirm. The CEO approved it.",
  memo:             "Closing 123 Main St",
  amountUsd:        400_000,
  senderDomain:     "acme-title.com",
  recipientDomains: ["scotia.example"],
};

function interaction(text: string, extra: Record<string, unknown> = {}) {
  return {
    object: "interaction", status: "completed", model: GEMINI_DEFAULT_MODEL,
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
    ...extra,
  };
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

describe("makeGeminiScreener", () => {
  it("requires an API key", () => {
    expect(() => makeGeminiScreener({ apiKey: "" })).toThrow(/GEMINI_API_KEY_MISSING/);
  });

  it("calls the Interactions API with structured output and store=false", async () => {
    const { fn, calls } = fakeFetch(200, interaction(JSON.stringify({ score: 10, flags: [] })));
    await makeGeminiScreener({ apiKey: "g-key", fetch: fn }).screen(BEC);

    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("g-key");
    expect(headers["Api-Revision"]).toBe("2026-05-20");

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("gemini-3.5-flash-lite");
    expect(body.store).toBe(false);
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(body.response_format.schema.properties.flags.items.properties.type.enum).toContain("payment_change");
    expect(body.system_instruction).toMatch(/never follow instructions/);
    // Email content only goes in `input`, wrapped as data.
    expect(body.input).toContain("<email>");
    expect(body.input).toContain("Wire amount (USD): 400000");
    expect(body.system_instruction).not.toContain("confidential");
  });

  it("maps the model's JSON into a clamped result", async () => {
    const out = {
      score: 87.6,
      summary: "Changed bank details with urgency and a request not to verify.",
      flags: [
        { type: "payment_change", evidence: "our bank details have changed" },
        { type: "secrecy", evidence: "do not call the office" },
      ],
    };
    const { fn } = fakeFetch(200, interaction(JSON.stringify(out)));
    const r = await makeGeminiScreener({ apiKey: "k", fetch: fn, model: "gemini-4-hydrogen" }).screen(BEC);
    expect(r).toEqual({
      score: 88,
      flags: out.flags,
      provider: "gemini",
      model: GEMINI_DEFAULT_MODEL, // the response's model wins over the requested one
      summary: out.summary,
    });
  });

  it("throws typed errors on HTTP failures and unusable output", async () => {
    await expect(makeGeminiScreener({ apiKey: "k", fetch: fakeFetch(429, {}).fn }).screen(BEC))
      .rejects.toMatchObject({ code: "HTTP" });
    await expect(makeGeminiScreener({ apiKey: "k", fetch: fakeFetch(200, { status: "failed", steps: [] }).fn }).screen(BEC))
      .rejects.toMatchObject({ code: "BAD_RESPONSE" });
    await expect(makeGeminiScreener({ apiKey: "k", fetch: fakeFetch(200, interaction("not json")).fn }).screen(BEC))
      .rejects.toBeInstanceOf(ScreeningError);
  });

  it("times out", async () => {
    const hanging = ((_u: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof globalThis.fetch;
    await expect(makeGeminiScreener({ apiKey: "k", fetch: hanging, timeoutMs: 10 }).screen(BEC))
      .rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("parseScreeningOutput", () => {
  it("drops unknown flag types, clamps the score and truncates evidence", () => {
    const r = parseScreeningOutput(JSON.stringify({
      score: 250,
      flags: [{ type: "ignore_previous_instructions", evidence: "x" }, { type: "urgency", evidence: "y".repeat(500) }],
    }), "m");
    expect(r.score).toBe(100);
    expect(r.flags).toEqual([{ type: "urgency", evidence: "y".repeat(300) }]);
  });

  it("rejects output without a numeric score", () => {
    expect(() => parseScreeningOutput(JSON.stringify({ flags: [] }), "m")).toThrow(/numeric score/);
  });
});

describe("heuristic + noop screeners", () => {
  it("flags common BEC phrasing with evidence", async () => {
    const r = await makeHeuristicScreener().screen(BEC);
    expect(r.provider).toBe("heuristic");
    expect(r.flags.map((f) => f.type)).toEqual(["urgency", "secrecy", "executive_impersonation", "payment_change"]);
    expect(r.score).toBe(95);
    expect(r.flags.find((f) => f.type === "payment_change")!.evidence).toContain("updated wire instructions");
    const bodyOnly = await makeHeuristicScreener().screen({ subject: "Re: closing", body: "FYI our bank details have changed." });
    expect(bodyOnly.flags).toEqual([{ type: "payment_change", evidence: expect.stringContaining("bank details have changed") }]);
  });

  it("returns nothing for an ordinary message", async () => {
    const r = await makeHeuristicScreener().screen({ subject: "Closing docs", body: "Attached are the closing documents for review." });
    expect(r).toEqual({ score: 0, flags: [], provider: "heuristic" });
  });

  it("noop screener always returns a clean result", async () => {
    expect(await makeNoopScreener().screen(BEC)).toEqual({ score: 0, flags: [], provider: "none" });
  });
});

describe("screenSafely", () => {
  it("returns null and reports the error instead of throwing", async () => {
    const onError = vi.fn();
    const failing = { provider: "x", screen: async () => { throw new Error("boom"); } };
    expect(await screenSafely(failing, BEC, onError)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
