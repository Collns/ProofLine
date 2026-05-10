/**
 * @file validatePolicy.ts
 * @module apps/functions/src/signing
 *
 * ALWAYS-ON POLICY VALIDATION PIPELINE (F-SIG-11 / ADR-0014 / TDD §11.6)
 *
 * This function MUST be called by every signing endpoint — POST /v1/sign,
 * POST /v1/sign-silent, POST /v1/sign/finalize — BEFORE any WebAuthn
 * assertion is verified or any signature is recorded.
 *
 * If this function returns { ok: false }, the endpoint MUST reject the request
 * and MUST NOT record any signature.
 *
 * Seven pipeline stages (each runs regardless of session state):
 *   1. Session validation (if session-claimed)
 *   2. User active check
 *   3. Role check (may have changed mid-session)
 *   4. Authority limits (per-email + daily aggregate)
 *   5. Device validation
 *   6. Counterparty status
 *   7. Anomaly heuristics
 */

import {
  EmailPayload,
  PolicyContext,
  PolicyDecision,
  PolicyError,
  PolicyResult,
  SessionTokenPayload,
  SigningSession,
} from "@proofline/types";

// ─── Internal request shape (broader than any one HTTP body) ─────────────────

interface PolicyCheckInput {
  /** Canonical email payload being signed. */
  payload: EmailPayload;

  /** sha256 of canonical bytes, computed by caller before this call. */
  payloadHash: string;

  /** Recipient set hash (sha256 of sorted To: addresses). */
  recipientSetHash: string;

  /** Firebase uid of the signing user. */
  userId: string;

  /** Tenant scope. */
  companyId: string;

  /** WebAuthn credential the client intends to use. */
  credentialId: string;

  /**
   * Present on the silent path.
   * Raw JWS string from chrome.storage.local.
   * If absent, request is treated as fresh-biometric.
   */
  sessionToken?: string;

  /**
   * Pre-parsed session token payload — populated by the endpoint handler
   * after JWS signature verification.  Must be present if sessionToken is
   * present; enforcement is a unit-test gate.
   */
  parsedSessionToken?: SessionTokenPayload;

  /**
   * True only when called from the finalize endpoint on the fresh path.
   * Used for the high-value bypass check (F-SES-07).
   */
  freshBiometric?: boolean;

  /**
   * Co-sign signatures already collected, if any.
   * Non-empty means we're on the cosign completion path.
   */
  cosignSignatures?: { signerId: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(code: PolicyError["code"], detail?: string): PolicyResult {
  return { ok: false, error: { code, detail } };
}

function okResult(decision: PolicyDecision): PolicyResult {
  return { ok: true, value: decision };
}

/** ISO-8601 YYYY-MM-DD used as daily aggregate key. */
function dayKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Run the full always-on policy pipeline.
 *
 * @returns PolicyResult — callers MUST check `.ok` before proceeding.
 *
 * INVARIANT: sign endpoint handlers must call this BEFORE verifying any
 * WebAuthn assertion and BEFORE writing to Firestore.
 */
export async function validatePolicy(
  input: PolicyCheckInput,
  ctx: PolicyContext
): Promise<PolicyResult> {
  const now = ctx.now();

  // ── Stage 1: Session validation ──────────────────────────────────────────
  // Only runs on the silent path (sessionToken present).
  // The session's presence does NOT skip stages 2–7.

  let session: SigningSession | null = null;

  if (input.sessionToken) {
    // Caller is responsible for JWS signature verification on the token
    // before reaching here (done in endpoint handler).
    const parsed = input.parsedSessionToken;
    if (!parsed) {
      return err(
        "SESSION_INVALID",
        "parsedSessionToken must be present when sessionToken is provided"
      );
    }

    // Re-fetch server record — the token alone is NOT sufficient authority
    // (TDD §11.5: "token is necessary but not sufficient").
    session = await ctx.getSession(parsed.sessionId);

    if (!session) {
      return err("SESSION_INVALID", "Session not found");
    }

    if (session.status === "revoked") {
      return err("SESSION_REVOKED");
    }

    if (session.status === "expired" || session.expiresAt < now) {
      return err("SESSION_EXPIRED");
    }

    // Hard cap (60 min absolute ceiling — F-SES-02)
    if (session.hardCapAt < now) {
      return err("SESSION_EXPIRED", "Hard cap reached");
    }

    // Scope guard: session must have been opened for this exact recipient set
    if (session.recipientSetHash !== input.recipientSetHash) {
      return err("SESSION_SCOPE_MISMATCH");
    }

    // Session must belong to this user & company
    if (session.userId !== input.userId || session.companyId !== input.companyId) {
      return err("SESSION_INVALID", "Session owner mismatch");
    }
  }

  // ── Stage 2: User active check ────────────────────────────────────────────

  const user = await ctx.getUser(input.userId);
  if (!user || user.status !== "active") {
    return err("USER_INACTIVE");
  }

  // ── Stage 3: Role check ───────────────────────────────────────────────────
  // Re-fetched every time — role may have changed mid-session (F-SES-06).

  if (!user.role || user.companyId !== input.companyId) {
    // If an active session exists, revoke it immediately (F-SES-06)
    if (session) {
      await ctx.revokeSession(session.sessionId, "role_changed", "system");
    }
    return err("ROLE_INVALID");
  }

  // ── Stage 4: Authority limits ─────────────────────────────────────────────

  if (input.payload.isWireInstruction) {
    const amount = input.payload.wirePayload?.amount ?? 0;

    // 4a. High-value threshold bypass check (F-SES-07)
    // Wire instructions above the company threshold ALWAYS require fresh
    // biometric regardless of session state.
    const policy = await ctx.getCompanyPolicy(input.companyId);
    if (amount > policy.highValueThresholdUsd && !input.freshBiometric) {
      return err(
        "HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC",
        `Amount ${amount} exceeds high-value threshold ${policy.highValueThresholdUsd}; ` +
          "fresh biometric required (F-SES-07)"
      );
    }

    // 4b. Per-email wire limit (cosign required)
    if (amount > user.wireLimitUsd && !(input.cosignSignatures?.length)) {
      // Resolve eligible approvers (managers + owners in the same company)
      // Returning COSIGN_REQUIRED is NOT an error — the client should
      // initiate the cosign flow then retry with cosignSignatures.
      return okResult({ decision: "COSIGN_REQUIRED", approvers: [] }); // approvers resolved by caller
    }

    // 4c. Daily aggregate check
    const todaysTotal = await ctx.getDailyAggregate(input.userId, dayKey(now));
    if (todaysTotal + amount > user.dailyLimitUsd) {
      return err(
        "POLICY_DAILY_AGGREGATE_EXCEEDED",
        `Daily aggregate ${todaysTotal + amount} would exceed limit ${user.dailyLimitUsd}`
      );
    }
  }

  // ── Stage 5: Device validation ────────────────────────────────────────────

  const device = user.devices.find((d) => d.credentialId === input.credentialId);
  if (!device) {
    return err("DEVICE_INVALID", "Credential not enrolled for this user");
  }
  if (device.revokedAt !== undefined) {
    // Revoke any session bound to this device (F-SES-06)
    if (session) {
      await ctx.revokeSession(session.sessionId, "device_revoked", "system");
    }
    return err("DEVICE_INVALID", "Credential has been revoked");
  }

  // ── Stage 6: Counterparty status ──────────────────────────────────────────
  // Check the primary To: recipient. If they are a known counterparty and
  // have been deactivated, block the signing.

  const primaryRecipient = input.payload.to[0];
  if (primaryRecipient) {
    const counterparty = await ctx.resolveCounterparty(primaryRecipient);
    if (counterparty && counterparty.status !== "active") {
      return err(
        "POLICY_COUNTERPARTY_DEACTIVATED",
        `Counterparty ${primaryRecipient} status: ${counterparty.status}`
      );
    }
  }

  // ── Stage 7: Anomaly heuristics ───────────────────────────────────────────
  // Velocity checks + payload pattern detection.
  // If flagged: revoke the active session to minimize blast radius.

  const anomaly = await ctx.checkAnomaly({
    userId: input.userId,
    velocity: { since: now - 60_000 }, // 1-minute window
    payload: input.payload,
  });

  if (anomaly.flagged) {
    if (session) {
      await ctx.revokeSession(session.sessionId, "anomaly_detected", "system");
    }
    return err("ANOMALY_FLAGGED", anomaly.reason);
  }

  // ── All checks passed ─────────────────────────────────────────────────────

  return okResult({ decision: "APPROVED" });
}