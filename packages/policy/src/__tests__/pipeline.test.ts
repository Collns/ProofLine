import { describe, it, expect, vi } from 'vitest';
import { runPolicyChecks } from '../pipeline.js';
import type {
  PolicyRequest,
  PolicyDeps,
  PolicyUser,
  PolicySession,
} from '../types.js';

const NOW = 1_700_000_000_000;

function makeDeps(overrides: Partial<PolicyDeps> = {}): PolicyDeps {
  return {
    validateSessionToken: async () => ({ ok: true, sessionId: 'sess-1' }),
    getSession: async (): Promise<PolicySession> => ({
      sessionId: 'sess-1',
      userId: 'user-1',
      companyId: 'co-1',
      recipientSetHash: 'hash-1',
      expiresAt: NOW + 60_000,
      status: 'active',
    }),
    getUser: async (): Promise<PolicyUser> => ({
      userId: 'user-1',
      companyId: 'co-1',
      status: 'active',
      role: 'employee',
      wireLimitUsd: 50_000,
      dailyLimitUsd: 200_000,
      devices: [{ credentialId: 'cred-1' }],
    }),
    getCompanyPolicy: async () => ({
      companyId: 'co-1',
      highValueThresholdUsd: 50_000,
    }),
    getDailyAggregate: async () => 0,
    resolveCounterparty: async () => null,
    checkAnomaly: async () => ({ flagged: false }),
    revokeSession: async () => undefined,
    getEligibleApprovers: async () => ['manager-1'],
    now: () => NOW,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    userId: 'user-1',
    companyId: 'co-1',
    credentialId: 'cred-1',
    recipientSetHash: 'hash-1',
    recipientAddresses: ['vendor@partner.com'],
    isWireInstruction: false,
    freshBiometric: false,
    ...overrides,
  };
}

describe('runPolicyChecks — happy paths', () => {
  it('approves a non-wire email request', async () => {
    const result = await runPolicyChecks(makeRequest(), makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });

  it('approves a wire under user authority limit', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 10_000 } },
      }),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });

  it('approves a session-claimed request when session is valid', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1' }),
      makeDeps(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });
});

describe('runPolicyChecks — session failures', () => {
  it('rejects with SESSION_INVALID when token is bad', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'bad' }),
      makeDeps({ validateSessionToken: async () => ({ ok: false }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_INVALID');
  });

  it('rejects with SESSION_INVALID when session not found', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1' }),
      makeDeps({ getSession: async () => null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_INVALID');
  });

  it('rejects with SESSION_INVALID when session status is not active', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1' }),
      makeDeps({
        getSession: async () => ({
          sessionId: 'sess-1',
          userId: 'user-1',
          companyId: 'co-1',
          recipientSetHash: 'hash-1',
          expiresAt: NOW + 60_000,
          status: 'revoked',
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_INVALID');
  });

  it('rejects with SESSION_EXPIRED when expiresAt is past', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1' }),
      makeDeps({
        getSession: async () => ({
          sessionId: 'sess-1',
          userId: 'user-1',
          companyId: 'co-1',
          recipientSetHash: 'hash-1',
          expiresAt: NOW - 1,
          status: 'active',
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects with SESSION_SCOPE_MISMATCH when recipient hash differs', async () => {
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1', recipientSetHash: 'different' }),
      makeDeps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_SCOPE_MISMATCH');
  });
});

describe('runPolicyChecks — user/role failures', () => {
  it('rejects with USER_INACTIVE when user status is inactive', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({
        getUser: async () => ({
          userId: 'user-1',
          companyId: 'co-1',
          status: 'inactive',
          role: 'employee',
          wireLimitUsd: 50_000,
          dailyLimitUsd: 200_000,
          devices: [{ credentialId: 'cred-1' }],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('USER_INACTIVE');
  });

  it('rejects with USER_INACTIVE when user not found', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({ getUser: async () => null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('USER_INACTIVE');
  });

  it('rejects with ROLE_INVALID when user has no role', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({
        getUser: async () => ({
          userId: 'user-1',
          companyId: 'co-1',
          status: 'active',
          role: null,
          wireLimitUsd: 50_000,
          dailyLimitUsd: 200_000,
          devices: [{ credentialId: 'cred-1' }],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_INVALID');
  });

  it('rejects with ROLE_INVALID when user is in different company', async () => {
    const result = await runPolicyChecks(
      makeRequest({ companyId: 'co-2' }),
      makeDeps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_INVALID');
  });
});

describe('runPolicyChecks — wire authority', () => {
  it('returns COSIGN_REQUIRED when amount exceeds wire limit, no cosigns', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 75_000 } },
        freshBiometric: true,
      }),
      makeDeps({
        getCompanyPolicy: async () => ({
          companyId: 'co-1',
          highValueThresholdUsd: 100_000,
        }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe('COSIGN_REQUIRED');
      if (result.value.decision === 'COSIGN_REQUIRED') {
        expect(result.value.eligibleApprovers).toEqual(['manager-1']);
      }
    }
  });

  it('approves when amount exceeds limit but cosigns are present', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 75_000 } },
        cosignSignatures: [{ sig: 'x' }],
        freshBiometric: true,
      }),
      makeDeps({
        getCompanyPolicy: async () => ({
          companyId: 'co-1',
          highValueThresholdUsd: 100_000,
        }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });

  it('rejects with FRESH_BIOMETRIC_REQUIRED for high-value with session', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 60_000 } },
        sessionToken: 'tok-1',
        freshBiometric: false,
      }),
      makeDeps({
        getUser: async () => ({
          userId: 'user-1',
          companyId: 'co-1',
          status: 'active',
          role: 'employee',
          wireLimitUsd: 100_000,
          dailyLimitUsd: 200_000,
          devices: [{ credentialId: 'cred-1' }],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FRESH_BIOMETRIC_REQUIRED');
  });

  it('approves high-value with freshBiometric=true', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 60_000 } },
        freshBiometric: true,
      }),
      makeDeps({
        getUser: async () => ({
          userId: 'user-1',
          companyId: 'co-1',
          status: 'active',
          role: 'employee',
          wireLimitUsd: 100_000,
          dailyLimitUsd: 200_000,
          devices: [{ credentialId: 'cred-1' }],
        }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });

  it('rejects with POLICY_DAILY_AGGREGATE_EXCEEDED', async () => {
    const result = await runPolicyChecks(
      makeRequest({
        isWireInstruction: true,
        payload: { wire: { amount: 10_000 } },
      }),
      makeDeps({ getDailyAggregate: async () => 195_000 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('POLICY_DAILY_AGGREGATE_EXCEEDED');
  });
});

describe('runPolicyChecks — device failures', () => {
  it('rejects with DEVICE_INVALID when credentialId not in user devices', async () => {
    const result = await runPolicyChecks(
      makeRequest({ credentialId: 'cred-unknown' }),
      makeDeps(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEVICE_INVALID');
  });

  it('rejects with DEVICE_INVALID when device is revoked', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({
        getUser: async () => ({
          userId: 'user-1',
          companyId: 'co-1',
          status: 'active',
          role: 'employee',
          wireLimitUsd: 50_000,
          dailyLimitUsd: 200_000,
          devices: [{ credentialId: 'cred-1', revokedAt: NOW - 1 }],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DEVICE_INVALID');
  });
});

describe('runPolicyChecks — counterparty', () => {
  it('rejects with COUNTERPARTY_DEACTIVATED when counterparty is deactivated', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({
        resolveCounterparty: async () => ({
          domain: 'partner.com',
          status: 'deactivated',
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COUNTERPARTY_DEACTIVATED');
  });

  it('approves when counterparty resolves to null (unknown is OK)', async () => {
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({ resolveCounterparty: async () => null }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('APPROVED');
  });
});

describe('runPolicyChecks — anomaly', () => {
  it('rejects with ANOMALY_FLAGGED and revokes session', async () => {
    const revokeSession = vi.fn(async () => undefined);
    const result = await runPolicyChecks(
      makeRequest({ sessionToken: 'tok-1' }),
      makeDeps({
        checkAnomaly: async () => ({ flagged: true }),
        revokeSession,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ANOMALY_FLAGGED');
    expect(revokeSession).toHaveBeenCalledTimes(1);
    expect(revokeSession).toHaveBeenCalledWith('sess-1', 'anomaly', 'system');
  });

  it('does not call revokeSession when no session present', async () => {
    const revokeSession = vi.fn(async () => undefined);
    const result = await runPolicyChecks(
      makeRequest(),
      makeDeps({
        checkAnomaly: async () => ({ flagged: true }),
        revokeSession,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ANOMALY_FLAGGED');
    expect(revokeSession).not.toHaveBeenCalled();
  });
});
