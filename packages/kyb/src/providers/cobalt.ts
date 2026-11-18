/**
 * @file cobalt.ts
 * @module packages/kyb/src/providers
 *
 * Cobalt Intelligence adapter — fallback KYB provider (PFL-165).
 *
 * Source: Cobalt's public API collection (documentation.cobaltintelligence.com,
 * checked 2026-11-18). Base URL https://apigateway.cobaltintelligence.com,
 * auth header `x-api-key`. One verifyBusiness() call fans out to three
 * endpoints in parallel:
 *
 *   GET /v1/search?searchQuery=&state=&liveData=true[&street=&city=&zip=]
 *       200 { status, statusCode, results[], alternativeResults?, verificationId? }
 *       202 { status: "Incomplete", retryId } → poll GET /v1/search?retryId=
 *   GET /tinVerification?tin=&businessName=
 *       200 { status: "TIN Matched" | "Did Not Match" | "Pending" | "Complete", irsCode, retryId? }
 *       500 when the IRS doesn't answer in ~28 s (not charged)
 *   GET /ofac?searchQuery=&score=[&stateOrProvince=&city=]
 *       200 { matchCount, matches[{ score, sanction{ id, name, source, categories } }] }
 *
 * Mapping to BusinessVerification:
 *   ok        = SoS result found && normalizedStatus active && TIN matched && no OFAC matches
 *   vendorRef = SoS sosId (else verificationId)
 *   officers  = SoS results[0].officers[] (name, title)
 *
 * TODO(PFL-165, needs API key): confirm with real responses
 *   - the set of `normalizedStatus` values (we treat "active" case-insensitively as good)
 *   - whether retry polling needs `state` alongside `retryId`
 *   - OFAC `score` param semantics (documented as a minimum score filter)
 */

import type {
  KYBProvider,
  KYBFlag,
  BusinessLookupInput,
  BusinessVerification,
  OfficerVerification,
} from "../types.js";

export const COBALT_DEFAULT_BASE_URL = "https://apigateway.cobaltintelligence.com";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CobaltConfig {
  apiKey: string;
  baseUrl?: string;
  /** Query the live state registry (default true). */
  liveData?: boolean;
  /** Max retryId polls for a slow SoS search (default 6). */
  maxPolls?: number;
  /** Delay between polls in ms (default 5000). Keep total under the function timeout. */
  pollIntervalMs?: number;
  /** OFAC minimum match score, 0–100 (default 90). */
  ofacMinScore?: number;
  fetch?: typeof globalThis.fetch;
  /** Sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

// ─── Response shapes (subset we use) ─────────────────────────────────────────

export interface CobaltOfficer {
  name?:    string;
  title?:   string;
  current?: string;
}

export interface CobaltSosResult {
  title?:            string;
  status?:           string;
  normalizedStatus?: string;
  entityType?:       string;
  stateOfFormation?: string;
  sosId?:            string;
  officers?:         CobaltOfficer[];
  [key: string]:     unknown;
}

export interface CobaltSosResponse {
  status?:             string;
  statusCode?:         number;
  message?:            string;
  retryId?:            string;
  verificationId?:     string;
  results?:            CobaltSosResult[];
  alternativeResults?: unknown[];
}

export interface CobaltTinResponse {
  name?:      string;
  tin?:       string;
  status?:    string;
  irsCode?:   number;
  irsReason?: string;
  retryId?:   string;
  message?:   string;
}

export interface CobaltOfacResponse {
  name?:       string;
  matchCount?: number;
  matches?: {
    score?:    number;
    sanction?: { id?: string; name?: string; source?: string; categories?: string[] };
  }[];
  message?: string;
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

export interface CobaltRaw {
  sos:  CobaltSosResponse | null;
  tin:  CobaltTinResponse | null;
  ofac: CobaltOfacResponse | null;
  errors: string[];
}

export function mapCobaltResults(raw: CobaltRaw): BusinessVerification {
  const flags: KYBFlag[] = [];
  let pending = false;

  // Secretary of State
  const sos = raw.sos;
  const result = sos?.results?.[0];
  if (!sos) {
    flags.push({ type: "sos_unavailable", severity: "medium", detail: "Secretary of State search failed" });
  } else if (sos.statusCode === 202 || sos.retryId && !result) {
    pending = true;
    flags.push({ type: "sos_pending", severity: "low", detail: sos.message ?? "State registry is slow; retry later" });
  } else if (!result) {
    flags.push({
      type: "sos_not_found",
      severity: "high",
      detail: (sos.alternativeResults?.length ?? 0) > 0
        ? "No exact registry match; alternative names returned"
        : "No registry record found",
    });
  } else if ((result.normalizedStatus ?? result.status ?? "").toLowerCase() !== "active") {
    flags.push({
      type: "sos_inactive",
      severity: "high",
      detail: `Registry status: ${result.normalizedStatus ?? result.status ?? "unknown"}`,
    });
  }

  // TIN
  const tin = raw.tin;
  const tinStatus = tin?.status ?? "";
  if (!tin) {
    pending = true;
    flags.push({ type: "tin_pending", severity: "low", detail: "IRS did not answer; retry later" });
  } else if (tinStatus === "TIN Matched") {
    // good
  } else if (tinStatus === "Did Not Match") {
    flags.push({ type: "tin_mismatch", severity: "high", detail: tin.irsReason ?? "EIN does not match IRS records" });
  } else if (tinStatus === "Pending") {
    pending = true;
    flags.push({ type: "tin_pending", severity: "low", detail: tin.irsReason ?? "IRS result pending" });
  } else {
    flags.push({ type: "tin_invalid", severity: "high", detail: tin.irsReason ?? `TIN status: ${tinStatus || "unknown"}` });
  }

  // OFAC
  const ofac = raw.ofac;
  const matches = ofac?.matches ?? [];
  if (!ofac) {
    flags.push({ type: "watchlist_unavailable", severity: "medium", detail: "OFAC screening failed" });
  } else {
    for (const m of matches.slice(0, 5)) {
      flags.push({
        type: `watchlist:${m.sanction?.source ?? "OFAC"}`,
        severity: "high",
        detail: `${m.sanction?.name ?? "match"} (score ${m.score ?? "?"})`,
      });
    }
  }

  const officers = (result?.officers ?? [])
    .filter((o) => typeof o.name === "string" && o.name.trim().length > 0)
    .map((o) => ({ name: o.name!.trim(), role: o.title?.trim() || "officer" }));

  const ok =
    !!result &&
    (result.normalizedStatus ?? result.status ?? "").toLowerCase() === "active" &&
    tinStatus === "TIN Matched" &&
    !!ofac &&
    (ofac.matchCount ?? matches.length) === 0;

  return {
    ok,
    vendorRef: result?.sosId ?? sos?.verificationId ?? sos?.retryId ?? "cobalt:unresolved",
    flags,
    officers,
    raw,
    provider: "cobalt",
    pending,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function makeCobaltProvider(config: CobaltConfig): KYBProvider {
  if (!config.apiKey) {
    throw new Error("COBALT_API_KEY_MISSING: apiKey is required");
  }
  const baseUrl = (config.baseUrl ?? COBALT_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPolls = config.maxPolls ?? 6;
  const pollIntervalMs = config.pollIntervalMs ?? 5000;

  async function get<T>(path: string, params: Record<string, string | undefined>): Promise<{ status: number; body: T }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, v);
    const res = await doFetch(`${baseUrl}${path}?${qs.toString()}`, {
      method:  "GET",
      headers: { "x-api-key": config.apiKey, Accept: "application/json" },
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body: body as T };
  }

  async function searchSos(input: BusinessLookupInput, errors: string[]): Promise<CobaltSosResponse | null> {
    const first = await get<CobaltSosResponse>("/v1/search", {
      searchQuery: input.legalName,
      state:       input.state.toLowerCase(),
      liveData:    String(config.liveData ?? true),
      street:      input.street,
      city:        input.city,
      zip:         input.zip,
    });
    if (first.status === 200) return first.body;
    if (first.status !== 202 || !first.body?.retryId) {
      errors.push(`sos HTTP ${first.status}: ${first.body?.message ?? ""}`.trim());
      return null;
    }

    let last = first.body;
    for (let i = 0; i < maxPolls; i++) {
      await sleep(pollIntervalMs);
      const poll = await get<CobaltSosResponse>("/v1/search", { retryId: last.retryId });
      if (poll.status === 200) return poll.body;
      if (poll.status !== 202) {
        errors.push(`sos retry HTTP ${poll.status}: ${poll.body?.message ?? ""}`.trim());
        return null;
      }
      last = { ...poll.body, retryId: poll.body?.retryId ?? last.retryId };
    }
    return { ...last, statusCode: 202 };
  }

  async function checkTin(input: BusinessLookupInput, errors: string[]): Promise<CobaltTinResponse | null> {
    const r = await get<CobaltTinResponse>("/tinVerification", {
      tin:          input.ein.replace(/\D+/g, ""),
      businessName: input.legalName,
    });
    if (r.status === 200) return r.body;
    errors.push(`tin HTTP ${r.status}: ${(r.body as { message?: string } | null)?.message ?? ""}`.trim());
    return null;
  }

  async function screenOfac(input: BusinessLookupInput, errors: string[]): Promise<CobaltOfacResponse | null> {
    const r = await get<CobaltOfacResponse>("/ofac", {
      searchQuery:     input.legalName,
      score:           String(config.ofacMinScore ?? 90),
      stateOrProvince: input.state,
      city:            input.city,
    });
    if (r.status === 200) return r.body;
    errors.push(`ofac HTTP ${r.status}: ${r.body?.message ?? ""}`.trim());
    return null;
  }

  return {
    async verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification> {
      const errors: string[] = [];
      const [sos, tin, ofac] = await Promise.all([
        searchSos(input, errors),
        checkTin(input, errors),
        screenOfac(input, errors),
      ]);
      return mapCobaltResults({ sos, tin, ofac, errors });
    },

    async verifyOfficer(): Promise<OfficerVerification> {
      throw new Error("WRONG_PROVIDER: Cobalt handles verifyBusiness only; use the IDV provider for officers");
    },
  };
}
