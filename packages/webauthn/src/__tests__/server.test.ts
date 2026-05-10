import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @simplewebauthn/server so tests run without real WebAuthn hardware
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// Mock node:crypto so we control the generated challenge bytes
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { InMemoryChallengeStore } from '../challenges.js';
import {
  startRegistration,
  finishRegistration,
  startAssertion,
  finishAssertion,
} from '../server.js';

// Fixed challenge bytes for deterministic tests
const FIXED_BYTES = new Uint8Array(32).fill(42);
const FIXED_CHALLENGE = Buffer.from(FIXED_BYTES).toString('base64url');

function makeClientDataJSON(challenge: string, type = 'webauthn.create'): string {
  const json = JSON.stringify({ type, challenge, origin: 'https://proofline.web.app' });
  return Buffer.from(json).toString('base64url');
}

function makeRegistrationResponse(challenge: string) {
  return {
    id: 'cred-id-base64url',
    rawId: 'cred-id-base64url',
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: makeClientDataJSON(challenge),
      attestationObject: Buffer.from('fake-attestation').toString('base64url'),
    },
  };
}

function makeAuthenticationResponse(challenge: string) {
  return {
    id: 'cred-id-base64url',
    rawId: 'cred-id-base64url',
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: makeClientDataJSON(challenge, 'webauthn.get'),
      authenticatorData: Buffer.from('fake-auth-data').toString('base64url'),
      signature: Buffer.from('fake-signature').toString('base64url'),
    },
  };
}

const FAKE_COSE_KEY = new Uint8Array(77).fill(9);
const STORED_PUBLIC_KEY = Buffer.from(FAKE_COSE_KEY).toString('base64');

function mockVerifyRegistrationSuccess() {
  vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
    verified: true,
    registrationInfo: {
      credentialID: 'cred-id-base64url',
      credentialPublicKey: FAKE_COSE_KEY,
      counter: 0,
      aaguid: '00000000-0000-0000-0000-000000000000',
      credentialType: 'public-key',
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      fmt: 'none',
      attestationObject: new Uint8Array(0),
      userVerified: true,
      origin: 'https://proofline.web.app',
      rpID: 'proofline.web.app',
    } as unknown as Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo'],
  } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);
}

function mockVerifyAuthenticationSuccess(newCounter = 1) {
  vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
    verified: true,
    authenticationInfo: {
      newCounter,
      credentialID: 'cred-id-base64url',
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      userVerified: true,
      origin: 'https://proofline.web.app',
      rpID: 'proofline.web.app',
    } as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>['authenticationInfo'],
  } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(randomBytes as (size: number) => Buffer).mockReturnValue(Buffer.from(FIXED_BYTES));
  vi.mocked(generateRegistrationOptions).mockResolvedValue({
    challenge: FIXED_CHALLENGE,
    rp: { name: 'ProofLine', id: 'proofline.web.app' },
    user: { id: 'dXNlci0x', name: 'test@example.com', displayName: 'Test User' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60000,
    excludeCredentials: [],
    attestation: 'none',
  } as unknown as Awaited<ReturnType<typeof generateRegistrationOptions>>);
  vi.mocked(generateAuthenticationOptions).mockResolvedValue({
    challenge: FIXED_CHALLENGE,
    rpId: 'proofline.web.app',
    allowCredentials: [],
    timeout: 60000,
    userVerification: 'preferred',
  } as unknown as Awaited<ReturnType<typeof generateAuthenticationOptions>>);
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe('startRegistration', () => {
  it('stores challenge and returns options', async () => {
    const store = new InMemoryChallengeStore();
    await startRegistration({
      userId: 'user-1',
      userName: 'test@example.com',
      userDisplayName: 'Test User',
      rpId: 'proofline.web.app',
      rpName: 'ProofLine',
      challengeStore: store,
    });
    const record = await store.get(FIXED_CHALLENGE);
    expect(record).not.toBeNull();
    expect(record!.userId).toBe('user-1');
    expect(record!.purpose).toBe('registration');
    expect(record!.consumed).toBe(false);
  });
});

describe('finishRegistration', () => {
  it('full registration round-trip succeeds', async () => {
    const store = new InMemoryChallengeStore();
    await startRegistration({
      userId: 'user-1',
      userName: 'test@example.com',
      userDisplayName: 'Test User',
      rpId: 'proofline.web.app',
      rpName: 'ProofLine',
      challengeStore: store,
    });
    mockVerifyRegistrationSuccess();

    const result = await finishRegistration({
      response: makeRegistrationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credential.credentialId).toBe('cred-id-base64url');
      expect(result.credential.signCount).toBe(0);
      expect(result.credential.publicKey).toBeTruthy();
    }
  });

  it('rejects unknown challenge', async () => {
    const store = new InMemoryChallengeStore();
    const result = await finishRegistration({
      response: makeRegistrationResponse('unknown-challenge') as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('challenge_invalid');
  });

  it('rejects already-consumed challenge', async () => {
    const store = new InMemoryChallengeStore();
    const now = Date.now();
    await store.put({
      challenge: FIXED_CHALLENGE,
      userId: 'user-1',
      purpose: 'registration',
      rpId: 'proofline.web.app',
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: true,
    });

    const result = await finishRegistration({
      response: makeRegistrationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('challenge_consumed');
  });

  it('rejects expired challenge (TTL exceeded)', async () => {
    const store = new InMemoryChallengeStore();
    const past = Date.now() - 1;
    await store.put({
      challenge: FIXED_CHALLENGE,
      userId: 'user-1',
      purpose: 'registration',
      rpId: 'proofline.web.app',
      createdAt: past - 60_000,
      expiresAt: past,
      consumed: false,
    });

    const result = await finishRegistration({
      response: makeRegistrationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('challenge_expired');
  });

  it('rejects origin mismatch when verifyRegistrationResponse throws', async () => {
    const store = new InMemoryChallengeStore();
    const now = Date.now();
    await store.put({
      challenge: FIXED_CHALLENGE,
      userId: 'user-1',
      purpose: 'registration',
      rpId: 'proofline.web.app',
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
      new Error('Unexpected registration response origin: expected "https://other.app"'),
    );

    const result = await finishRegistration({
      response: makeRegistrationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('origin_mismatch');
  });

  it('rejects when verifyRegistrationResponse returns verified: false', async () => {
    const store = new InMemoryChallengeStore();
    const now = Date.now();
    await store.put({
      challenge: FIXED_CHALLENGE,
      userId: 'user-1',
      purpose: 'registration',
      rpId: 'proofline.web.app',
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: false,
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const result = await finishRegistration({
      response: makeRegistrationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('verification_failed');
  });
});

// ─── Assertion ────────────────────────────────────────────────────────────────

describe('startAssertion', () => {
  it('stores challenge and returns options', async () => {
    const store = new InMemoryChallengeStore();
    await startAssertion({
      userId: 'user-1',
      rpId: 'proofline.web.app',
      userVerification: 'preferred',
      challengeStore: store,
    });
    const record = await store.get(FIXED_CHALLENGE);
    expect(record).not.toBeNull();
    expect(record!.purpose).toBe('assertion');
  });
});

describe('finishAssertion', () => {
  it('full assertion round-trip succeeds', async () => {
    const store = new InMemoryChallengeStore();
    await startAssertion({
      userId: 'user-1',
      rpId: 'proofline.web.app',
      userVerification: 'preferred',
      challengeStore: store,
    });
    mockVerifyAuthenticationSuccess(1);

    const result = await finishAssertion({
      response: makeAuthenticationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      storedPublicKey: STORED_PUBLIC_KEY,
      storedSignCount: 0,
      challengeStore: store,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signCount).toBe(1);
      expect(result.credentialId).toBe('cred-id-base64url');
    }
  });

  it('rejects when signCount goes backward (replay attack)', async () => {
    const store = new InMemoryChallengeStore();
    const now = Date.now();
    await store.put({
      challenge: FIXED_CHALLENGE,
      userId: 'user-1',
      purpose: 'assertion',
      rpId: 'proofline.web.app',
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });
    // newCounter = 0 < storedSignCount = 5 → replay
    mockVerifyAuthenticationSuccess(0);

    const result = await finishAssertion({
      response: makeAuthenticationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      storedPublicKey: STORED_PUBLIC_KEY,
      storedSignCount: 5,
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('signcount_replay');
  });

  it('accepts userVerification: discouraged', async () => {
    const store = new InMemoryChallengeStore();
    await startAssertion({
      userId: 'user-1',
      rpId: 'proofline.web.app',
      userVerification: 'discouraged',
      challengeStore: store,
    });
    mockVerifyAuthenticationSuccess(1);

    const result = await finishAssertion({
      response: makeAuthenticationResponse(FIXED_CHALLENGE) as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      storedPublicKey: STORED_PUBLIC_KEY,
      storedSignCount: 0,
      challengeStore: store,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown challenge', async () => {
    const store = new InMemoryChallengeStore();
    const result = await finishAssertion({
      response: makeAuthenticationResponse('ghost-challenge') as never,
      expectedRPID: 'proofline.web.app',
      expectedOrigin: 'https://proofline.web.app',
      storedPublicKey: STORED_PUBLIC_KEY,
      storedSignCount: 0,
      challengeStore: store,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('challenge_invalid');
  });
});
