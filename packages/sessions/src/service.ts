import { randomUUID } from 'node:crypto';
import type { TokenSigner, TokenVerifier } from './tokens.js';
import {
  type SigningSession,
  type SessionError,
  type SessionRevokeReason,
  type Result,
  ok,
  err,
} from './types.js';
import { recipientSetHash } from './recipient-set.js';

export interface SessionStore {
  create(session: SigningSession): Promise<void>;
  get(sessionId: string): Promise<SigningSession | null>;
  update(
    sessionId: string,
    patch: Partial<SigningSession>,
  ): Promise<SigningSession | null>;
  listActiveByUser(companyId: string, userId?: string): Promise<SigningSession[]>;
}

export interface SessionServiceDeps {
  store: SessionStore;
  signer: TokenSigner;
  verifier: TokenVerifier;
  now: () => number;
  uuid?: () => string;
  defaultTtlMs?: number;
  hardCapMs?: number;
}

export interface OpenSessionInput {
  userId: string;
  companyId: string;
  recipientAddresses: string[];
  deviceCredentialId: string;
}

export interface SessionService {
  open(
    input: OpenSessionInput,
  ): Promise<Result<{ session: SigningSession; token: string }, SessionError>>;

  validate(input: {
    token: string;
    recipientSetHash: string;
  }): Promise<Result<SigningSession, SessionError>>;

  extend(
    sessionId: string,
  ): Promise<Result<SigningSession, SessionError>>;

  revoke(input: {
    sessionId: string;
    revokedBy: string;
    reason: SessionRevokeReason;
  }): Promise<Result<void, SessionError>>;

  listActive(input: {
    companyId: string;
    userId?: string;
  }): Promise<SigningSession[]>;
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const SIXTY_MIN_MS = 60 * 60 * 1000;

export function makeSessionService(deps: SessionServiceDeps): SessionService {
  const ttlMs = deps.defaultTtlMs ?? FIFTEEN_MIN_MS;
  const hardCapMs = deps.hardCapMs ?? SIXTY_MIN_MS;
  const uuid = deps.uuid ?? randomUUID;

  return {
    async open(input) {
      const now = deps.now();
      const sessionId = uuid();
      const rsh = recipientSetHash(input.recipientAddresses);

      const session: SigningSession = {
        sessionId,
        userId: input.userId,
        companyId: input.companyId,
        recipientSetHash: rsh,
        recipientAddresses: [...input.recipientAddresses],
        authorizedAt: now,
        expiresAt: now + ttlMs,
        hardCapAt: now + hardCapMs,
        deviceCredentialId: input.deviceCredentialId,
        status: 'active',
        lastUsedAt: now,
        signCount: 0,
      };

      try {
        await deps.store.create(session);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err({ code: 'INTERNAL', message: msg });
      }

      const token = await deps.signer.sign({
        v: 1,
        sessionId,
        userId: input.userId,
        companyId: input.companyId,
        recipientSetHash: rsh,
        iat: Math.floor(now / 1000),
        exp: Math.floor((now + ttlMs) / 1000),
      });

      return ok({ session, token });
    },

    async validate(input) {
      const verified = await deps.verifier.verify(input.token);
      if (!verified.ok) return verified;

      const payload = verified.value;
      if (payload.recipientSetHash !== input.recipientSetHash) {
        return err({ code: 'SESSION_SCOPE_MISMATCH' });
      }

      const session = await deps.store.get(payload.sessionId);
      if (!session) return err({ code: 'SESSION_NOT_FOUND' });

      const now = deps.now();
      if (session.status === 'revoked') {
        return err({
          code: 'SESSION_REVOKED',
          reason: session.revokeReason ?? 'admin_manual',
        });
      }
      if (session.status === 'expired' || session.expiresAt < now) {
        return err({ code: 'SESSION_EXPIRED' });
      }
      if (session.hardCapAt < now) {
        return err({ code: 'SESSION_HARD_CAP_REACHED' });
      }
      if (session.recipientSetHash !== input.recipientSetHash) {
        return err({ code: 'SESSION_SCOPE_MISMATCH' });
      }

      return ok(session);
    },

    async extend(sessionId) {
      const session = await deps.store.get(sessionId);
      if (!session) return err({ code: 'SESSION_NOT_FOUND' });
      if (session.status !== 'active') {
        return err({ code: 'SESSION_EXPIRED' });
      }

      const now = deps.now();
      if (session.hardCapAt < now) {
        await deps.store.update(sessionId, { status: 'expired' });
        return err({ code: 'SESSION_HARD_CAP_REACHED' });
      }

      const newExpiresAt = Math.min(now + ttlMs, session.hardCapAt);
      const updated = await deps.store.update(sessionId, {
        expiresAt: newExpiresAt,
        lastUsedAt: now,
        signCount: session.signCount + 1,
      });
      if (!updated) return err({ code: 'SESSION_NOT_FOUND' });
      return ok(updated);
    },

    async revoke(input) {
      const session = await deps.store.get(input.sessionId);
      if (!session) return err({ code: 'SESSION_NOT_FOUND' });

      await deps.store.update(input.sessionId, {
        status: 'revoked',
        revokedAt: deps.now(),
        revokedBy: input.revokedBy,
        revokeReason: input.reason,
      });
      return ok(undefined);
    },

    async listActive(input) {
      return deps.store.listActiveByUser(input.companyId, input.userId);
    },
  };
}
