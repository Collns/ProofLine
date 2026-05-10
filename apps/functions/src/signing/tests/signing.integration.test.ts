/**
 * @file signing.integration.test.ts
 * @module apps/functions/src/signing
 *
 * Integration tests for PFL-021 acceptance criteria.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CompanyPolicy,
  CounterpartyRecord,
  EmailPayload,
  PolicyContext,
  SessionTokenPayload,
  SigningSession,
  UserRecord,
} from "@proofline/types";
import { validatePolicy } from "@proofline/policy";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_POLICY: CompanyPolicy = {
  companyId: "acme-title",
  highValueThresholdUsd: 50_000,
  sessionTtlMs: 15 * 60 * 1000,
  sessionHardCapMs: 60 * 60 * 1000,
  cosignTtlMs: 30 * 60 * 1000,
};

const ACTIVE_USER: UserRecord = {
  userId: "sarah-01",
  companyId: "acme-title",
  status: "active",
  role: "employee",
  wireLimitUsd: 50_000,
  dailyLimitUsd: 200_000,
  devices: [
    {
      credentialId: "cred-sarah-macbook",
      publicKey: "spki-base64-placeholder",
      enrolledAt: 1_000_000,
    },
  ],
};

function makeWirePayload(amount: number) {
  return {
    v: 1 as const,
    amount,
    currency: "USD" as const,
    recipientAccount: "12345678",
    recipientRouting: "021000021",
    memo: "Test wire",
  };
}

function makeEmailPayload(overrides: Partial<EmailPayload> = {}): EmailPayload {
  return {
    v: 1,
    from: "sarah@acme-title.com",
    to: ["mark@scotiabank.com"],
    cc: [],
    bcc: [],
    subject: "Closing documents for 123 Elm",
    body: "Please find the documents attached.",
    isWireInstruction: false,
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + 24 * 60 * 60 * 1000,
    nonce: "y8f3k2m9p1q7r5s6t0v4w8x2",
    companyId: "acme-title",
    ...overrides,
  };
}

function makeActiveSession(overrides: Partial<SigningSession> = {}): SigningSession {
  const now = 1_700_000_000_000;
  return {
    sessionId: "sess-00000000-0000-0000-0000-000000000001",
    userId: "sarah-01",
    companyId: "acme-title",
    recipientSetHash: "a".repeat(64),
    recipientAddresses: ["mark@scotiabank.com"],
    authorizedAt: now - 5 * 60 * 1000,
    expiresAt: now + 10 * 60 * 1000,
    hardCapAt: now + 55 * 60 * 1000,
    deviceCredentialId: "cred-sarah-macbook",
    status: "active",
    lastUsedAt: now - 2 * 60 * 1000,
    signCount: 3,
    ...overrides,
  };
}

function makeParsedToken(
  session: SigningSession,
  overrides: Partial<SessionTokenPayload> = {}
): SessionTokenPayload {
  return {
    v: 1,
    sessionId: session.sessionId,
    userId: session.userId,
    companyId: session.companyId,
    recipientScope: session.recipientSetHash,
    iat: session.authorizedAt,
    exp: session.expiresAt,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const session = makeActiveSession();
  return {
    getUser: vi.fn().mockResolvedValue(ACTIVE_USER),
    getSession: vi.fn().mockResolvedValue(session),
    getCompanyPolicy: vi.fn().mockResolvedValue(BASE_POLICY),
    getDailyAggregate: vi.fn().mockResolvedValue(0),
    resolveCounterparty: vi.fn().mockResolvedValue(null),
    checkAnomaly: vi.fn().mockResolvedValue({ flagged: false }),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    isNonceUsed: vi.fn().mockResolvedValue(false),
    recordNonce: vi.fn().mockResolvedValue(undefined),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

// ─── A. Happy path — fresh biometric ─────────────────────────────────────────

describe("A. Happy path — fresh biometric", () => {
  it("returns APPROVED for a normal email within limits", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "a".repeat(64),
        recipientSetHash: "b".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    expect((result as any).value.decision).toBe("APPROVED");
  });

  it("returns APPROVED for a wire instruction within Sarah's limit", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(25_000),
        }),
        payloadHash: "a".repeat(64),
        recipientSetHash: "b".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    expect((result as any).value.decision).toBe("APPROVED");
  });

  it("returns COSIGN_REQUIRED when wire exceeds Sarah's per-email limit", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(75_000),
        }),
        payloadHash: "a".repeat(64),
        recipientSetHash: "b".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
        cosignSignatures: [],
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    expect((result as any).value.decision).toBe("COSIGN_REQUIRED");
  });
});

// ─── B. Happy path — silent in-session ───────────────────────────────────────

describe("B. Happy path — silent in-session", () => {
  it("returns APPROVED for a reply within an active session", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({ getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "c".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.header.payload.sig",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect((result as any).value.decision).toBe("APPROVED");
    expect(ctx.revokeSession).not.toHaveBeenCalled();
  });

  it("runs ALL 7 policy stages even inside an active session (F-SIG-11)", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({ getSession: vi.fn().mockResolvedValue(session) });

    await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(25_000),
        }),
        payloadHash: "c".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.header.payload.sig",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(ctx.getUser).toHaveBeenCalledWith("sarah-01");
    expect(ctx.getCompanyPolicy).toHaveBeenCalledWith("acme-title");
    expect(ctx.checkAnomaly).toHaveBeenCalled();
    expect(ctx.resolveCounterparty).toHaveBeenCalled();
  });
});

// ─── C. Expired session ───────────────────────────────────────────────────────

describe("C. Expired session", () => {
  it("returns SESSION_EXPIRED when expiresAt < now", async () => {
    const now = 1_700_000_000_000;
    const session = makeActiveSession({ expiresAt: now - 1 });
    const ctx = makeCtx({ now: () => now, getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "d".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("SESSION_EXPIRED");
  });

  it("returns SESSION_EXPIRED when hardCapAt < now", async () => {
    const now = 1_700_000_000_000;
    const session = makeActiveSession({
      expiresAt: now + 5 * 60 * 1000,
      hardCapAt: now - 1,
    });
    const ctx = makeCtx({ now: () => now, getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "e".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("SESSION_EXPIRED");
  });

  it("returns SESSION_REVOKED when session status is revoked", async () => {
    const session = makeActiveSession({ status: "revoked" });
    const ctx = makeCtx({ getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "f".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("SESSION_REVOKED");
  });

  it("returns SESSION_SCOPE_MISMATCH when recipient set changed", async () => {
    const session = makeActiveSession({ recipientSetHash: "a".repeat(64) });
    const ctx = makeCtx({ getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "g".repeat(64),
        recipientSetHash: "b".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("SESSION_SCOPE_MISMATCH");
  });
});

// ─── D. Role change mid-session ───────────────────────────────────────────────

describe("D. Role change mid-session", () => {
  it("returns ROLE_INVALID and revokes session when companyId mismatches", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({
      getSession: vi.fn().mockResolvedValue(session),
      getUser: vi.fn().mockResolvedValue({ ...ACTIVE_USER, companyId: "different-company" }),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "h".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("ROLE_INVALID");
    expect(ctx.revokeSession).toHaveBeenCalledWith(session.sessionId, "role_changed", "system");
  });

  it("returns USER_INACTIVE when user is suspended mid-session", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({
      getSession: vi.fn().mockResolvedValue(session),
      getUser: vi.fn().mockResolvedValue({ ...ACTIVE_USER, status: "suspended" }),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "i".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("USER_INACTIVE");
  });

  it("returns USER_INACTIVE when user is deleted mid-session", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({
      getSession: vi.fn().mockResolvedValue(session),
      getUser: vi.fn().mockResolvedValue(null),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "j".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("USER_INACTIVE");
  });
});

// ─── E. Daily aggregate exceeded ──────────────────────────────────────────────

describe("E. Daily aggregate exceeded", () => {
  it("returns POLICY_DAILY_AGGREGATE_EXCEEDED when wire would breach daily limit", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(25_000), // 180k + 25k = 205k > 200k
        }),
        payloadHash: "k".repeat(64),
        recipientSetHash: "l".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx({ getDailyAggregate: vi.fn().mockResolvedValue(180_000) })
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("POLICY_DAILY_AGGREGATE_EXCEEDED");
  });

  it("returns APPROVED when amount exactly equals remaining daily headroom", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(20_000), // 180k + 20k = 200k exactly
        }),
        payloadHash: "m".repeat(64),
        recipientSetHash: "n".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx({ getDailyAggregate: vi.fn().mockResolvedValue(180_000) })
    );

    expect(result.ok).toBe(true);
    expect((result as any).value.decision).toBe("APPROVED");
  });
});

// ─── F. Anomaly fired ─────────────────────────────────────────────────────────

describe("F. Anomaly heuristic fired", () => {
  it("returns ANOMALY_FLAGGED and revokes active session", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({
      getSession: vi.fn().mockResolvedValue(session),
      checkAnomaly: vi.fn().mockResolvedValue({ flagged: true, reason: "High velocity" }),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "o".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("ANOMALY_FLAGGED");
    expect(ctx.revokeSession).toHaveBeenCalledWith(session.sessionId, "anomaly_detected", "system");
  });

  it("returns ANOMALY_FLAGGED on fresh path without revoking session", async () => {
    const ctx = makeCtx({
      checkAnomaly: vi.fn().mockResolvedValue({ flagged: true, reason: "Unusual pattern" }),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "p".repeat(64),
        recipientSetHash: "q".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("ANOMALY_FLAGGED");
    expect(ctx.revokeSession).not.toHaveBeenCalled();
  });
});

// ─── G. High-value threshold bypass (F-SES-07) ───────────────────────────────

describe("G. High-value threshold bypass (F-SES-07)", () => {
  it("returns HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC on silent path above threshold", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({ getSession: vi.fn().mockResolvedValue(session) });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(75_000),
        }),
        payloadHash: "r".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC");
  });

  it("allows high-value wire on fresh path with freshBiometric=true", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload({
          isWireInstruction: true,
          wirePayload: makeWirePayload(75_000),
        }),
        payloadHash: "s".repeat(64),
        recipientSetHash: "t".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
  });
});

// ─── H. Device revoked mid-session ───────────────────────────────────────────

describe("H. Device revoked mid-session", () => {
  it("returns DEVICE_INVALID and revokes session", async () => {
    const session = makeActiveSession();
    const ctx = makeCtx({
      getSession: vi.fn().mockResolvedValue(session),
      getUser: vi.fn().mockResolvedValue({
        ...ACTIVE_USER,
        devices: [
          {
            credentialId: "cred-sarah-macbook",
            publicKey: "spki-base64-placeholder",
            enrolledAt: 1_000_000,
            revokedAt: 1_699_000_000_000,
          },
        ],
      }),
    });

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "u".repeat(64),
        recipientSetHash: session.recipientSetHash,
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: makeParsedToken(session),
        freshBiometric: false,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("DEVICE_INVALID");
    expect(ctx.revokeSession).toHaveBeenCalledWith(session.sessionId, "device_revoked", "system");
  });
});

// ─── I. Counterparty deactivated ─────────────────────────────────────────────

describe("I. Counterparty deactivated", () => {
  it("returns POLICY_COUNTERPARTY_DEACTIVATED", async () => {
    const deactivated: CounterpartyRecord = {
      email: "mark@scotiabank.com",
      companyId: "scotiabank",
      status: "deactivated",
    };

    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "v".repeat(64),
        recipientSetHash: "w".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        freshBiometric: true,
      },
      makeCtx({ resolveCounterparty: vi.fn().mockResolvedValue(deactivated) })
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("POLICY_COUNTERPARTY_DEACTIVATED");
  });
});

// ─── J. Session token guard ───────────────────────────────────────────────────

describe("J. Session token guard", () => {
  it("returns SESSION_INVALID when parsedSessionToken is missing", async () => {
    const result = await validatePolicy(
      {
        payload: makeEmailPayload(),
        payloadHash: "x".repeat(64),
        recipientSetHash: "y".repeat(64),
        userId: "sarah-01",
        companyId: "acme-title",
        credentialId: "cred-sarah-macbook",
        sessionToken: "jws.token",
        parsedSessionToken: undefined,
        freshBiometric: false,
      },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect((result as any).error.code).toBe("SESSION_INVALID");
  });
});