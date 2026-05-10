import type {
  PolicyRequest,
  PolicyResult,
  PolicyDeps,
  PolicyError,
  PolicyDecision,
} from './types.js';

const ok = (decision: PolicyDecision): PolicyResult =>
  ({ ok: true, value: decision });

const err = (error: PolicyError): PolicyResult =>
  ({ ok: false, error });

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function runPolicyChecks(
  request: PolicyRequest,
  deps: PolicyDeps,
): Promise<PolicyResult> {
  const now = deps.now();

  // 1. Session validation
  let session = null;
  if (request.sessionToken) {
    const tokenCheck = await deps.validateSessionToken(request.sessionToken);
    if (!tokenCheck.ok) {
      return err({ code: 'SESSION_INVALID' });
    }
    session = await deps.getSession(tokenCheck.sessionId);
    if (!session) {
      return err({ code: 'SESSION_INVALID', detail: 'session not found' });
    }
    if (session.status !== 'active') {
      return err({ code: 'SESSION_INVALID', detail: `status: ${session.status}` });
    }
    if (session.expiresAt < now) {
      return err({ code: 'SESSION_EXPIRED' });
    }
    if (session.recipientSetHash !== request.recipientSetHash) {
      return err({ code: 'SESSION_SCOPE_MISMATCH' });
    }
  }

  // 2. User active check
  const user = await deps.getUser(request.userId);
  if (!user || user.status !== 'active') {
    return err({ code: 'USER_INACTIVE' });
  }

  // 3. Role check
  if (!user.role || user.companyId !== request.companyId) {
    return err({ code: 'ROLE_INVALID' });
  }

  // 4. Authority limits (only if wire instruction)
  let cosignRequired: { eligibleApprovers: string[] } | null = null;
  if (request.isWireInstruction) {
    const amount = request.payload?.wire?.amount ?? 0;

    if (amount > user.wireLimitUsd) {
      if (!request.cosignSignatures || request.cosignSignatures.length === 0) {
        const approvers = await deps.getEligibleApprovers(request.companyId, amount);
        cosignRequired = { eligibleApprovers: approvers };
      }
    }

    const policy = await deps.getCompanyPolicy(request.companyId);
    if (amount > policy.highValueThresholdUsd) {
      if (!request.freshBiometric) {
        return err({ code: 'FRESH_BIOMETRIC_REQUIRED' });
      }
    }

    const todaysTotal = await deps.getDailyAggregate(
      request.userId,
      dayKey(now),
    );
    if (todaysTotal + amount > user.dailyLimitUsd) {
      return err({ code: 'POLICY_DAILY_AGGREGATE_EXCEEDED' });
    }
  }

  // 5. Device validation
  const device = user.devices.find(
    d => d.credentialId === request.credentialId,
  );
  if (!device) {
    return err({ code: 'DEVICE_INVALID', detail: 'device not registered' });
  }
  if (device.revokedAt !== undefined && device.revokedAt !== null) {
    return err({ code: 'DEVICE_INVALID', detail: 'device revoked' });
  }

  // 6. Counterparty status
  if (request.recipientAddresses.length > 0) {
    const counterparty = await deps.resolveCounterparty(
      request.recipientAddresses[0],
    );
    if (counterparty && counterparty.status !== 'active') {
      return err({ code: 'COUNTERPARTY_DEACTIVATED' });
    }
  }

  // 7. Anomaly heuristics
  const anomaly = await deps.checkAnomaly({
    userId: request.userId,
    velocity: { since: now - 60_000 },
    payload: request.payload,
  });
  if (anomaly.flagged) {
    if (session) {
      await deps.revokeSession(session.sessionId, 'anomaly', 'system');
    }
    return err({ code: 'ANOMALY_FLAGGED' });
  }

  if (cosignRequired) {
    return ok({
      decision: 'COSIGN_REQUIRED',
      eligibleApprovers: cosignRequired.eligibleApprovers,
    });
  }
  return ok({ decision: 'APPROVED' });
}
