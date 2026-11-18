/**
 * @file baselayer.ts
 * @module packages/kyb/src/providers
 *
 * Baselayer adapter — primary KYB provider (PFL-161).
 *
 * API (docs.baselayer.com, checked 2026-11-18):
 *   POST https://api.baselayer.com/searches        (same host for sandbox + prod;
 *                                                    the API key decides the env)
 *   Header  X-API-Key: <key>
 *   Header  Prefer: wait=N   (N ≤ 90) — 201 Created when finished within N s,
 *                                       202 Accepted with state PENDING otherwise
 *   Body    { name, address (freeform, ≥ city + state), tin?, website?,
 *             officer_names?, reference_id? }
 *   GET     /searches/{id}   — same body once complete
 *   Webhooks (Svix): BusinessSearch.completed / .failed / .updated (.updated
 *   carries the late tin_matched after an IRS outage).
 *
 * Mapping to BusinessVerification:
 *   ok        = state COMPLETED && verified === true && tin_matched === true
 *               && no watchlist list with count > 0
 *   vendorRef = search id
 *   flags     = warnings, tin mismatch / pending, watchlist hits, name /
 *               address mismatches, not-verified, failed search
 *   officers  = business.business_officers, else the union of
 *               business.registrations[].officers
 *
 * TODO(PFL-161, needs sandbox key): confirm against a real sandbox response
 *   - `warnings` is shown both as a string and as string[] in the docs
 *   - whether `business.business_officers` exists or only registrations[].officers
 *   - exact `watchlist_hits[].details` shape when count > 0
 */

import * as crypto from "node:crypto";

import type {
  KYBProvider,
  KYBFlag,
  BusinessLookupInput,
  BusinessVerification,
  OfficerVerification,
} from "../types.js";

export const BASELAYER_DEFAULT_BASE_URL = "https://api.baselayer.com";
const MAX_WAIT_SECONDS = 90;

// ─── Config ──────────────────────────────────────────────────────────────────

export interface BaselayerConfig {
  apiKey: string;
  /** Defaults to https://api.baselayer.com (sandbox vs prod is the key). */
  baseUrl?: string;
  /** Seconds to wait synchronously (Prefer: wait=N). Default 25, max 90. */
  waitSeconds?: number;
  /** Fetch override for tests. */
  fetch?: typeof globalThis.fetch;
}

// ─── Response shapes (subset we use) ─────────────────────────────────────────

export type BaselayerState = "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface BaselayerOfficer {
  name:    string;
  titles?: string[];
}

export interface BaselayerWatchlistHit {
  code:     string;
  name?:    string;
  count:    number;
  details?: unknown[];
}

export interface BaselayerSearch {
  id:                      string;
  state:                   BaselayerState;
  verified?:               boolean | null;
  tin_matched?:            boolean | null;
  watchlist_hits?:         BaselayerWatchlistHit[];
  business_name_match?:    string | null;
  business_address_match?: string | null;
  business_officer_match?: string | null;
  warnings?:               string | string[] | null;
  error?:                  string | null;
  scores?:                 { type: string; score: number; rating: string }[];
  business?: {
    id?:                string;
    name?:              string;
    business_officers?: BaselayerOfficer[];
    officers?:          BaselayerOfficer[];
    registrations?:     { state?: string; status?: string; officers?: BaselayerOfficer[] }[];
  } | null;
  __event__?: { type: string; origin?: string };
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function warningsOf(search: BaselayerSearch): string[] {
  const w = search.warnings;
  if (!w) return [];
  return Array.isArray(w) ? w.filter((x) => typeof x === "string" && x.length > 0) : [w];
}

function officersOf(search: BaselayerSearch): { name: string; role: string }[] {
  const business = search.business ?? undefined;
  const direct = business?.business_officers ?? business?.officers;
  const source: BaselayerOfficer[] = direct && direct.length > 0
    ? direct
    : (business?.registrations ?? []).flatMap((r) => r.officers ?? []);

  const seen = new Set<string>();
  const out: { name: string; role: string }[] = [];
  for (const o of source) {
    if (!o?.name) continue;
    const key = o.name.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: o.name.trim(), role: o.titles?.[0] ?? "officer" });
  }
  return out;
}

export function mapBaselayerSearch(search: BaselayerSearch): BusinessVerification {
  const flags: KYBFlag[] = [];
  const pendingStates: BaselayerState[] = ["PENDING", "EXECUTING"];
  const searchPending = pendingStates.includes(search.state);

  if (searchPending) {
    flags.push({ type: "search_pending", severity: "low", detail: `Baselayer search ${search.state}` });
  }
  if (search.state === "FAILED" || search.state === "CANCELLED") {
    flags.push({
      type: "search_failed",
      severity: "high",
      detail: search.error ?? `Baselayer search ${search.state}`,
    });
  }

  for (const w of warningsOf(search)) {
    flags.push({ type: "warning", severity: "medium", detail: w });
  }

  const tinPending = search.state === "COMPLETED" && search.tin_matched == null;
  if (search.tin_matched === false) {
    flags.push({ type: "tin_mismatch", severity: "high", detail: "EIN does not match IRS records for this name" });
  } else if (tinPending) {
    flags.push({ type: "tin_pending", severity: "low", detail: "IRS check unavailable; awaiting BusinessSearch.updated" });
  }

  const hits = (search.watchlist_hits ?? []).filter((h) => (h.count ?? 0) > 0);
  for (const h of hits) {
    flags.push({ type: `watchlist:${h.code}`, severity: "high", detail: h.name ?? h.code });
  }

  if (search.business_name_match === "NO_MATCH") {
    flags.push({ type: "name_mismatch", severity: "high" });
  } else if (search.business_name_match === "SIMILAR") {
    flags.push({ type: "name_similar", severity: "low" });
  }
  if (search.business_address_match === "NO_MATCH") {
    flags.push({ type: "address_mismatch", severity: "medium" });
  }
  if (search.state === "COMPLETED" && search.verified === false) {
    flags.push({ type: "not_verified", severity: "high", detail: "Baselayer could not verify the business" });
  }

  const ok =
    search.state === "COMPLETED" &&
    search.verified === true &&
    search.tin_matched === true &&
    hits.length === 0;

  return {
    ok,
    vendorRef: search.id,
    flags,
    officers:  officersOf(search),
    raw:       search,
    provider:  "baselayer",
    pending:   searchPending || tinPending,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

function addressLine(input: BusinessLookupInput): string {
  return [input.street, input.city, [input.state, input.zip].filter(Boolean).join(" ")]
    .filter((p) => typeof p === "string" && p.trim().length > 0)
    .join(", ");
}

export function makeBaselayerProvider(config: BaselayerConfig): KYBProvider {
  if (!config.apiKey) {
    throw new Error("BASELAYER_API_KEY_MISSING: apiKey is required");
  }
  const baseUrl = (config.baseUrl ?? BASELAYER_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const wait = Math.max(1, Math.min(config.waitSeconds ?? 25, MAX_WAIT_SECONDS));
  const doFetch = config.fetch ?? globalThis.fetch;

  return {
    async verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification> {
      const body: Record<string, unknown> = {
        name:    input.legalName,
        address: addressLine(input),
        tin:     input.ein.replace(/\D+/g, ""),
      };
      if (input.website) body["website"] = input.website;
      if (input.officerNames && input.officerNames.length > 0) body["officer_names"] = input.officerNames;

      const res = await doFetch(`${baseUrl}/searches`, {
        method:  "POST",
        headers: {
          "X-API-Key":    config.apiKey,
          "Content-Type": "application/json",
          Accept:         "application/json",
          Prefer:         `wait=${wait}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status !== 200 && res.status !== 201 && res.status !== 202) {
        let detail = "";
        try { detail = JSON.stringify(await res.json()).slice(0, 300); } catch { /* not JSON */ }
        throw new Error(`BASELAYER_HTTP_${res.status}${detail ? `: ${detail}` : ""}`);
      }

      const search = (await res.json()) as BaselayerSearch;
      if (!search.id) {
        const fromHeader = res.headers.get("X-Resource-Id");
        if (fromHeader) search.id = fromHeader;
      }
      if (!search.id) {
        throw new Error("BASELAYER_BAD_RESPONSE: search has no id");
      }
      if (res.status === 202 && !search.state) search.state = "PENDING";
      return mapBaselayerSearch(search);
    },

    async verifyOfficer(): Promise<OfficerVerification> {
      throw new Error("WRONG_PROVIDER: Baselayer handles verifyBusiness only; use the IDV provider for officers");
    },
  };
}

// ─── Webhooks (Svix) ─────────────────────────────────────────────────────────
//
// Baselayer delivers webhooks through Svix. Svix signs
//   `${svix-id}.${svix-timestamp}.${rawBody}`
// with HMAC-SHA256 using the base64 part of the `whsec_…` secret, and sends
// `svix-signature: v1,<base64> [v1,<base64> …]`.
// TODO(PFL-161): re-check against the Svix manual verification guide when
// wiring the webhook route; consider the official `svix` package instead.

export interface SvixHeaders {
  "svix-id"?:        string;
  "svix-timestamp"?: string;
  "svix-signature"?: string;
}

const SVIX_TOLERANCE_SECONDS = 5 * 60;

export function verifyBaselayerWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader || !secret) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSeconds - tsNum) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();

  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Maps a BusinessSearch.* webhook payload to the event type + result. */
export function parseBaselayerWebhook(payload: BaselayerSearch): {
  event:  string | undefined;
  result: BusinessVerification;
} {
  return { event: payload.__event__?.type, result: mapBaselayerSearch(payload) };
}
