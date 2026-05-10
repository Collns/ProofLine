/**
 * @file middesk.ts
 * @module packages/kyb/src/providers
 *
 * Middesk adapter for ProofLine business verification.
 *
 * Per TDD §7.1:
 *   1. POST /v1/businesses with name + EIN + state to start a verification.
 *   2. Middesk runs SOS, watchlist, sanctions, etc. asynchronously.
 *   3. Poll GET /v1/businesses/{id} until status === "in_audit" or
 *      review_status is final ("approved" | "rejected" | "manual_review").
 *   4. Map response to BusinessVerification (ok, vendorRef, flags, officers).
 *
 * verifyOfficer() is NOT implemented here — Stripe Identity handles
 * officer KYC (see ./stripe-identity.ts).  This provider throws if called.
 *
 * API docs reference: https://docs.middesk.com/reference/businesses
 */

import type {
  KYBProvider,
  BusinessLookupInput,
  BusinessVerification,
  OfficerKYCInput,
  OfficerVerification,
  KYBFlag,
} from "../types.js";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface MiddeskConfig {
  apiKey:   string;
  /**
   * Base URL — sandbox is `https://api-sandbox.middesk.com`,
   * production is `https://api.middesk.com`.  Default: sandbox.
   */
  baseUrl?: string;
  /** Polling interval in ms.  Default: 2 seconds. */
  pollIntervalMs?: number;
  /** Total timeout in ms after which we give up.  Default: 90 seconds. */
  pollTimeoutMs?: number;
  /**
   * Optional fetch override — for tests, pass a stub fetch that
   * returns canned Middesk responses.  Production omits this.
   */
  fetch?: typeof globalThis.fetch;
}

// ─── Middesk response shapes (subset we use) ──────────────────────────────────

interface MiddeskBusinessResponse {
  object:        "business";
  id:            string;
  status:        "open" | "in_audit" | "in_review" | "closed";
  review?: {
    object:    "review";
    assignee?: string | null;
    status:    "approved" | "rejected" | "manual_review" | "open";
    completed_at?: string | null;
  };
  name:          string | null;
  tin?:          { tin: string; tin_type: string } | null;
  addresses?:    Array<{ state: string }>;
  watchlist?: {
    listed:        boolean;
    sources?:      Array<{ name: string; matches?: unknown[] }>;
  };
  sanctions?: {
    listed:        boolean;
    matches?:      unknown[];
  };
  officers?: Array<{
    name:    string;
    titles?: string[];
    sources?: string[];
  }>;
  /** Set if Middesk could not match the EIN to the legal name. */
  tin_status?: "found" | "not_found" | "issue";
  /** Catch-all for unknown fields — preserved in raw. */
  [key: string]: unknown;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

export function makeMiddeskProvider(config: MiddeskConfig): KYBProvider {
  const baseUrl        = config.baseUrl        ?? "https://api-sandbox.middesk.com";
  const pollIntervalMs = config.pollIntervalMs ?? 2_000;
  const pollTimeoutMs  = config.pollTimeoutMs  ?? 90_000;
  const fetchImpl      = config.fetch          ?? globalThis.fetch;

  if (!config.apiKey) throw new Error("MIDDESK_API_KEY_MISSING");
  if (typeof fetchImpl !== "function") throw new Error("MIDDESK_FETCH_UNAVAILABLE");

  // ── Internal: start a verification ──────────────────────────────────────────

  async function startVerification(
    input: BusinessLookupInput,
  ): Promise<MiddeskBusinessResponse> {
    const res = await fetchImpl(`${baseUrl}/v1/businesses`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        name: input.legalName,
        tin:  { tin: input.ein.replace("-", "") },
        addresses: [{ state: input.state }],
        // Country is implicit US for Middesk; their API doesn't take it.
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MIDDESK_START_FAILED: ${res.status} ${text}`);
    }

    return (await res.json()) as MiddeskBusinessResponse;
  }

  // ── Internal: poll until terminal status ────────────────────────────────────

  async function pollUntilComplete(
    businessId: string,
  ): Promise<MiddeskBusinessResponse> {
    const deadline = Date.now() + pollTimeoutMs;

    while (Date.now() < deadline) {
      const res = await fetchImpl(`${baseUrl}/v1/businesses/${businessId}`, {
        method:  "GET",
        headers: { "Authorization": `Bearer ${config.apiKey}` },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`MIDDESK_POLL_FAILED: ${res.status} ${text}`);
      }

      const body = (await res.json()) as MiddeskBusinessResponse;

      if (isTerminal(body)) return body;

      await sleep(pollIntervalMs);
    }

    throw new Error(`MIDDESK_POLL_TIMEOUT: business ${businessId} did not complete within ${pollTimeoutMs}ms`);
  }

  // ── Public — verifyBusiness ─────────────────────────────────────────────────

  async function verifyBusiness(
    input: BusinessLookupInput,
  ): Promise<BusinessVerification> {
    const initial = await startVerification(input);
    const final   = isTerminal(initial) ? initial : await pollUntilComplete(initial.id);

    return mapToBusinessVerification(input, final);
  }

  // ── Public — verifyOfficer is not handled by Middesk ───────────────────────

  async function verifyOfficer(_input: OfficerKYCInput): Promise<OfficerVerification> {
    throw new Error(
      "MIDDESK_DOES_NOT_HANDLE_OFFICER_KYC: " +
      "Use makeStripeIdentityProvider for verifyOfficer or compose with makeCompositeKYBProvider"
    );
  }

  return { verifyBusiness, verifyOfficer };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTerminal(body: MiddeskBusinessResponse): boolean {
  // "in_audit" means Middesk's automated checks finished and a review
  // is in progress (or done).  "closed" is the end state after review.
  // We accept "in_audit" because in sandbox, review may stay open
  // indefinitely — the audit signal alone is enough for our purposes.
  if (body.status === "closed") return true;
  if (body.review?.status && body.review.status !== "open") return true;
  if (body.status === "in_audit") return true;
  return false;
}

/**
 * Map a Middesk response into ProofLine's BusinessVerification.
 *
 * Decision matrix:
 *   review.status === "approved"     → ok = true
 *   review.status === "rejected"     → ok = false (high severity flags expected)
 *   review.status === "manual_review"→ ok = false (medium-severity flag, requires human)
 *   no review yet but in_audit       → ok = !sanctions && !watchlist && tin_found
 */
function mapToBusinessVerification(
  input: BusinessLookupInput,
  body:  MiddeskBusinessResponse,
): BusinessVerification {
  const flags = extractFlags(input, body);

  let ok: boolean;
  switch (body.review?.status) {
    case "approved":      ok = true;  break;
    case "rejected":      ok = false; break;
    case "manual_review": ok = false; break;
    default:
      // No review verdict yet — derive from flags.
      ok = flags.every((f) => f.severity !== "high");
  }

  const officers = (body.officers ?? []).map((o) => ({
    name: o.name,
    role: (o.titles?.[0] ?? "Officer"),
  }));

  return {
    ok,
    vendorRef: body.id,
    flags,
    officers,
    raw: body,
  };
}

function extractFlags(
  input: BusinessLookupInput,
  body:  MiddeskBusinessResponse,
): KYBFlag[] {
  const flags: KYBFlag[] = [];

  if (body.sanctions?.listed) {
    flags.push({
      type:     "sanctions_match",
      severity: "high",
      detail:   `Entity matched on sanctions list (${body.sanctions.matches?.length ?? "unknown"} matches)`,
    });
  }

  if (body.watchlist?.listed) {
    flags.push({
      type:     "watchlist_match",
      severity: "high",
      detail:   `Entity matched on watchlist (${body.watchlist.sources?.length ?? 0} sources)`,
    });
  }

  if (body.tin_status === "not_found") {
    flags.push({
      type:     "ein_not_found",
      severity: "high",
      detail:   `EIN ${input.ein} not found in IRS database`,
    });
  } else if (body.tin_status === "issue") {
    flags.push({
      type:     "ein_issue",
      severity: "medium",
      detail:   `IRS reported an issue with EIN ${input.ein}`,
    });
  }

  // Middesk normalizes names — if the returned name doesn't match
  // the submitted legal name, surface that as a medium flag.
  if (body.name && body.name.trim().toLowerCase() !== input.legalName.trim().toLowerCase()) {
    flags.push({
      type:     "name_mismatch",
      severity: "medium",
      detail:   `Submitted "${input.legalName}" but registered name is "${body.name}"`,
    });
  }

  if (body.review?.status === "manual_review") {
    flags.push({
      type:     "manual_review_required",
      severity: "medium",
      detail:   "Middesk flagged this business for manual review",
    });
  }

  return flags;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}