import { describe, it, expect, beforeAll, vi } from 'vitest';
import { generateKeyPair, type CryptoKey } from 'jose';
import { createSign, createPublicKey } from 'node:crypto';
import {
  type PolicyDeps,
  type PolicyError,
  type PolicyRequest,
  type PolicyResult,
} from '@proofline/policy';
import type { WebAuthnAssertion } from '@proofline/webauthn';
import {
  makeSilentSignCoordinator,
  type AssertionVerifier,
  type SilentSignCoordinator,
  type SilentSignDeps,
  type StoredCredential,
} from '../silent-sign.js';
import { makeSessionService, type SessionStore } from '../service.js';
import { makeJoseSigner, makeJoseVerifier } from '../tokens.js';
import { recipientSetHash } from '../recipient-set.js';
import type { SigningSession } from '../types.js';

const NOW = Date.now();
const TTL_MS = 15 * 60 * 1000;
const HARD_CAP_MS = 60 * 60 * 1000;
const RECIPIENTS = ['vendor@partner.com'];
const PAYLOAD_HASH =
  'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';

function makeMemoryStore(): SessionStore & {
  sessions: Map<string, SigningSession>;
} {
  const sessions = new Map<string, SigningSession>();
  return {
    sessions,
    async create(s) {
      sessions.set(s.sessionId, { ...s });
    },
    async get(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },
    async update(id, patch) {
      const existing = sessions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      sessions.set(id, updated);
      return { ...updated };
    },
    async listActiveByUser(companyId, userId) {
      return Array.from(sessions.values()).filter(
        (s) =>
          s.companyId === companyId &&
          s.status === 'active' &&
          (userId ? s.userId === userId : true),
      );
    },
  };
}

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256');
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
});

interface Harness {
  coordinator: SilentSignCoordinator;
  store: ReturnType<typeof makeMemoryStore>;
  nowRef: { value: number };
  sessionToken: string;
  session: SigningSession;
  policyResult: { value: PolicyResult };
  assertionVerifier: AssertionVerifier;
  verifyMock: ReturnType<typeof vi.fn>;
  getCredentialMock: ReturnType<typeof vi.fn>;
  onSignCountUpdate: ReturnType<typeof vi.fn>;
  policyDeps: PolicyDeps;
  basePolicyRequest: PolicyRequest;
  storedCredential: StoredCredential;
}

async function makeHarness(opts: {
  initialPolicyResult?: PolicyResult;
  assertionResult?: { ok: true; newSignCount: number } | { ok: false; reason: string };
  credential?: StoredCredential | null;
} = {}): Promise<Harness> {
  const store = makeMemoryStore();
  const nowRef = { value: NOW };
  const signer = makeJoseSigner({ privateKey, publicKey });
  const verifier = makeJoseVerifier({ privateKey, publicKey });

  const sessionService = makeSessionService({
    store,
    signer,
    verifier,
    now: () => nowRef.value,
    uuid: () => 'sess-1',
  });

  const opened = await sessionService.open({
    userId: 'user-1',
    companyId: 'co-1',
    recipientAddresses: RECIPIENTS,
    deviceCredentialId: 'cred-1',
  });
  if (!opened.ok) throw new Error('failed to open session');

  const policyResult: { value: PolicyResult } = {
    value: opts.initialPolicyResult ?? { ok: true, value: { decision: 'APPROVED' } },
  };

  const storedCredential = opts.credential === undefined
    ? { publicKey: 'pk-base64', signCount: 0 }
    : (opts.credential ?? { publicKey: 'pk-base64', signCount: 0 });

  const verifyMock = vi.fn<AssertionVerifier['verify']>(async () =>
    opts.assertionResult ?? ({ ok: true as const, newSignCount: 1 }),
  );
  const assertionVerifier: AssertionVerifier = { verify: verifyMock };

  const getCredentialMock = vi.fn(async () =>
    opts.credential === null ? null : storedCredential,
  );

  const onSignCountUpdate = vi.fn(async () => undefined);

  // Minimal PolicyDeps; only used if a test routes through real runPolicyChecks.
  // All tests in this file inject `runPolicy` so these stubs are unused, but
  // typed-correctly stubs keep the seam honest.
  const policyDeps: PolicyDeps = {
    validateSessionToken: async () => ({ ok: true, sessionId: 'sess-1' }),
    getSession: async () => null,
    getUser: async () => null,
    getCompanyPolicy: async () => ({ companyId: 'co-1', highValueThresholdUsd: 50_000 }),
    getDailyAggregate: async () => 0,
    resolveCounterparty: async () => null,
    checkAnomaly: async () => ({ flagged: false }),
    revokeSession: async () => undefined,
    getEligibleApprovers: async () => [],
    now: () => nowRef.value,
  };

  const basePolicyRequest: PolicyRequest = {
    userId: 'user-1',
    companyId: 'co-1',
    credentialId: 'cred-1',
    recipientSetHash: recipientSetHash(RECIPIENTS),
    recipientAddresses: RECIPIENTS,
    isWireInstruction: false,
    freshBiometric: false,
    sessionToken: opened.value.token,
  };

  const deps: SilentSignDeps = {
    sessionService,
    policyDeps,
    assertionVerifier,
    getCredential: getCredentialMock,
    now: () => nowRef.value,
    onSignCountUpdate,
    runPolicy: async () => policyResult.value,
  };

  const coordinator = makeSilentSignCoordinator(deps);

  return {
    coordinator,
    store,
    nowRef,
    sessionToken: opened.value.token,
    session: opened.value.session,
    policyResult,
    assertionVerifier,
    verifyMock,
    getCredentialMock,
    onSignCountUpdate,
    policyDeps,
    basePolicyRequest,
    storedCredential,
  };
}

const baseAssertion = (): WebAuthnAssertion => ({
  credentialId: 'cred-1',
  clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJ4In0',
  authenticatorData: 'YXV0aA',
  signature: 'c2lnLWJhc2U2NHVybA',
});

describe('SilentSignCoordinator.silentSignChallenge', () => {
  it('happy path: returns challenge equal to canonicalPayloadHash and sessionId', async () => {
    const h = await makeHarness();
    const result = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.challenge).toBe(PAYLOAD_HASH);
      expect(result.value.sessionId).toBe('sess-1');
    }
  });

  it('session token invalid sig → SESSION_INVALID with TOKEN_INVALID_SIG', async () => {
    const h = await makeHarness();
    // Sign a token with a different key
    const otherKp = await generateKeyPair('ES256');
    const wrongSigner = makeJoseSigner({
      privateKey: otherKp.privateKey,
      publicKey: otherKp.publicKey,
    });
    const badToken = await wrongSigner.sign({
      v: 1,
      sessionId: 'sess-1',
      userId: 'user-1',
      companyId: 'co-1',
      recipientSetHash: recipientSetHash(RECIPIENTS),
      iat: Math.floor(h.nowRef.value / 1000),
      exp: Math.floor((h.nowRef.value + TTL_MS) / 1000),
    });
    const result = await h.coordinator.silentSignChallenge({
      sessionToken: badToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'SESSION_INVALID') {
      expect(result.error.sessionError.code).toBe('TOKEN_INVALID_SIG');
    } else {
      throw new Error('expected SESSION_INVALID/TOKEN_INVALID_SIG');
    }
  });

  it('session expired → SESSION_INVALID with SESSION_EXPIRED', async () => {
    const h = await makeHarness();
    h.store.sessions.get('sess-1')!.expiresAt = h.nowRef.value - 1;
    h.nowRef.value += 1;
    const result = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'SESSION_INVALID') {
      expect(result.error.sessionError.code).toBe('SESSION_EXPIRED');
    } else {
      throw new Error('expected SESSION_INVALID/SESSION_EXPIRED');
    }
  });

  it('session revoked → SESSION_INVALID with SESSION_REVOKED', async () => {
    const h = await makeHarness();
    await h.coordinator; // no-op, await harness setup
    const stored = h.store.sessions.get('sess-1')!;
    stored.status = 'revoked';
    stored.revokeReason = 'admin_manual';
    const result = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'SESSION_INVALID') {
      expect(result.error.sessionError.code).toBe('SESSION_REVOKED');
    } else {
      throw new Error('expected SESSION_INVALID/SESSION_REVOKED');
    }
  });

  it('policy returns FRESH_BIOMETRIC_REQUIRED → FRESH_BIOMETRIC_REQUIRED reason high_value', async () => {
    const policyError: PolicyError = { code: 'FRESH_BIOMETRIC_REQUIRED' };
    const h = await makeHarness({
      initialPolicyResult: { ok: false, error: policyError },
    });
    const result = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'FRESH_BIOMETRIC_REQUIRED') {
      expect(result.error.reason).toBe('high_value');
    } else {
      throw new Error('expected FRESH_BIOMETRIC_REQUIRED');
    }
  });
});

describe('SilentSignCoordinator.silentSignFinalize', () => {
  it('happy path: builds EnvelopeRecord, extends session, persists new signCount', async () => {
    const h = await makeHarness();
    const ch = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    if (!ch.ok) throw new Error('challenge failed');

    h.nowRef.value += 60_000;
    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: ch.value.challenge,
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.envelopeRecord.canonicalPayloadHash).toBe(PAYLOAD_HASH);
    expect(result.value.envelopeRecord.credentialId).toBe('cred-1');
    expect(result.value.envelopeRecord.signature).toBe(baseAssertion().signature);
    expect(result.value.envelopeRecord.sessionId).toBe('sess-1');
    expect(result.value.envelopeRecord.signedAt).toBe(h.nowRef.value);
    expect(result.value.session.expiresAt).toBe(h.nowRef.value + TTL_MS);
    expect(h.onSignCountUpdate).toHaveBeenCalledWith({
      credentialId: 'cred-1',
      newSignCount: 1,
    });
  });

  it('canonicalPayloadHash differs from step1ChallengeHash → CHALLENGE_MISMATCH', async () => {
    const h = await makeHarness();
    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: 'a-different-hash',
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CHALLENGE_MISMATCH');
    expect(h.verifyMock).not.toHaveBeenCalled();
  });

  it('assertion verifier returns invalid → ASSERTION_INVALID with reason passthrough', async () => {
    const h = await makeHarness({
      assertionResult: { ok: false, reason: 'signature_mismatch' },
    });
    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: PAYLOAD_HASH,
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'ASSERTION_INVALID') {
      expect(result.error.reason).toBe('signature_mismatch');
    } else {
      throw new Error('expected ASSERTION_INVALID');
    }
  });

  it('session revoked between step 1 and step 2 → SESSION_INVALID with SESSION_REVOKED', async () => {
    const h = await makeHarness();
    const ch = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    if (!ch.ok) throw new Error('challenge failed');

    // Admin revokes mid-flow
    const stored = h.store.sessions.get('sess-1')!;
    stored.status = 'revoked';
    stored.revokeReason = 'role_changed';

    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: ch.value.challenge,
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'SESSION_INVALID') {
      expect(result.error.sessionError.code).toBe('SESSION_REVOKED');
    } else {
      throw new Error('expected SESSION_INVALID/SESSION_REVOKED');
    }
  });

  it('policy fails between step 1 and step 2 → POLICY_FAILED (proves F-SIG-11 always-on)', async () => {
    const h = await makeHarness();
    const ch = await h.coordinator.silentSignChallenge({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest: h.basePolicyRequest,
    });
    if (!ch.ok) throw new Error('challenge failed');

    // Mid-flow: user role changed in admin console
    h.policyResult.value = {
      ok: false,
      error: { code: 'ROLE_INVALID', detail: 'role removed' },
    };

    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: ch.value.challenge,
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'POLICY_FAILED') {
      expect(result.error.policyError.code).toBe('ROLE_INVALID');
    } else {
      throw new Error('expected POLICY_FAILED');
    }
    // Assertion verifier never reached because policy short-circuits
    expect(h.verifyMock).not.toHaveBeenCalled();
  });
});

describe('SilentSignCoordinator — cross-cutting', () => {
  it('end-to-end with REAL ES256 assertion verifier', async () => {
    // Generate a P-256 keypair and sign the challenge with node:crypto;
    // wire a real assertion verifier that ECDSA-verifies against it.
    const { generateKeyPair: nodeGenerateKeyPair } = await import('node:crypto');
    const { promisify } = await import('node:util');
    const genKp = promisify(nodeGenerateKeyPair);
    const { privateKey: ecPriv, publicKey: ecPub } = await genKp('ec', {
      namedCurve: 'P-256',
    });

    const realVerifier: AssertionVerifier = {
      async verify({ assertion, expectedChallenge, storedSignCount, storedPublicKey }) {
        try {
          const sigBuf = Buffer.from(assertion.signature, 'base64url');
          const challengeBuf = Buffer.from(expectedChallenge, 'utf8');
          const pubKey = createPublicKey({
            key: storedPublicKey,
            format: 'pem',
          });
          const verify = createSign('sha256');
          // Use the node verify path via crypto.verify
          const { verify: cryptoVerify } = await import('node:crypto');
          const ok = cryptoVerify(
            'sha256',
            challengeBuf,
            { key: pubKey, dsaEncoding: 'der' },
            sigBuf,
          );
          if (!ok) return { ok: false, reason: 'signature_mismatch' };
          return { ok: true, newSignCount: storedSignCount + 1 };
        } catch (e) {
          return { ok: false, reason: e instanceof Error ? e.message : 'verify_error' };
        }
      },
    };

    // Sign the challenge with the EC private key (server side stand-in for authenticator)
    const { sign: nodeSign } = await import('node:crypto');
    const sigBuf = nodeSign('sha256', Buffer.from(PAYLOAD_HASH, 'utf8'), {
      key: ecPriv,
      dsaEncoding: 'der',
    });
    const sigB64u = sigBuf.toString('base64url');
    const ecPubPem = ecPub.export({ type: 'spki', format: 'pem' }).toString();

    // Build harness, then swap in real verifier + matching credential
    const store = makeMemoryStore();
    const nowRef = { value: NOW };
    const sessionService = makeSessionService({
      store,
      signer: makeJoseSigner({ privateKey, publicKey }),
      verifier: makeJoseVerifier({ privateKey, publicKey }),
      now: () => nowRef.value,
      uuid: () => 'sess-1',
    });
    const opened = await sessionService.open({
      userId: 'user-1',
      companyId: 'co-1',
      recipientAddresses: RECIPIENTS,
      deviceCredentialId: 'cred-1',
    });
    if (!opened.ok) throw new Error('open failed');

    const policyDeps: PolicyDeps = {
      validateSessionToken: async () => ({ ok: true, sessionId: 'sess-1' }),
      getSession: async () => null,
      getUser: async () => null,
      getCompanyPolicy: async () => ({ companyId: 'co-1', highValueThresholdUsd: 50_000 }),
      getDailyAggregate: async () => 0,
      resolveCounterparty: async () => null,
      checkAnomaly: async () => ({ flagged: false }),
      revokeSession: async () => undefined,
      getEligibleApprovers: async () => [],
      now: () => nowRef.value,
    };

    const coordinator = makeSilentSignCoordinator({
      sessionService,
      policyDeps,
      assertionVerifier: realVerifier,
      getCredential: async () => ({ publicKey: ecPubPem, signCount: 7 }),
      now: () => nowRef.value,
      runPolicy: async () => ({ ok: true, value: { decision: 'APPROVED' } }),
    });

    const policyRequest: PolicyRequest = {
      userId: 'user-1',
      companyId: 'co-1',
      credentialId: 'cred-1',
      recipientSetHash: recipientSetHash(RECIPIENTS),
      recipientAddresses: RECIPIENTS,
      isWireInstruction: false,
      freshBiometric: false,
      sessionToken: opened.value.token,
    };

    const ch = await coordinator.silentSignChallenge({
      sessionToken: opened.value.token,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      policyRequest,
    });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;

    const finalized = await coordinator.silentSignFinalize({
      sessionToken: opened.value.token,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: ch.value.challenge,
      assertion: {
        credentialId: 'cred-1',
        clientDataJSON: Buffer.from(JSON.stringify({ challenge: PAYLOAD_HASH }), 'utf8').toString('base64url'),
        authenticatorData: 'YXV0aA',
        signature: sigB64u,
      },
      policyRequest,
    });
    expect(finalized.ok).toBe(true);
    if (finalized.ok) {
      expect(finalized.value.envelopeRecord.signature).toBe(sigB64u);
      expect(finalized.value.envelopeRecord.canonicalPayloadHash).toBe(PAYLOAD_HASH);
    }
  });

  it('hard cap reached during finalize → SESSION_HARD_CAP_REACHED', async () => {
    const h = await makeHarness();
    // Validate inside finalize hits hardCapAt < now → SESSION_HARD_CAP_REACHED
    h.store.sessions.get('sess-1')!.expiresAt = NOW + 30 * 60 * 1000;
    h.store.sessions.get('sess-1')!.hardCapAt = NOW - 1;
    h.nowRef.value = NOW + 1;

    const result = await h.coordinator.silentSignFinalize({
      sessionToken: h.sessionToken,
      recipientAddresses: RECIPIENTS,
      canonicalPayloadHash: PAYLOAD_HASH,
      step1ChallengeHash: PAYLOAD_HASH,
      assertion: baseAssertion(),
      policyRequest: h.basePolicyRequest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_HARD_CAP_REACHED');
    expect(h.verifyMock).not.toHaveBeenCalled();
  });
});
