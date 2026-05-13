import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorDevice,
} from '@simplewebauthn/types';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

function randomBytes(length: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(length));
}
import type { ChallengeStore, RegistrationResult } from './types.js';

const CHALLENGE_TTL_MS = 60_000;

export interface StartRegistrationInput {
  userId: string;
  userName: string;
  userDisplayName: string;
  rpId: string;
  rpName: string;
  excludeCredentials?: { id: string; type: 'public-key' }[];
  challengeStore: ChallengeStore;
  now?: () => number;
}

export async function startRegistration(
  input: StartRegistrationInput,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const challengeBytes = randomBytes(32);
  const challenge = Buffer.from(challengeBytes).toString('base64url');
  const now = input.now?.() ?? Date.now();

  await input.challengeStore.put({
    challenge,
    userId: input.userId,
    purpose: 'registration',
    rpId: input.rpId,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    consumed: false,
  });

  return generateRegistrationOptions({
    rpName: input.rpName,
    rpID: input.rpId,
    userID: new TextEncoder().encode(input.userId),
    userName: input.userName,
    userDisplayName: input.userDisplayName,
    challenge: challengeBytes,
    excludeCredentials: input.excludeCredentials?.map(c => ({ id: c.id })),
  });
}

export type FinishRegistrationFailureReason =
  | 'challenge_invalid'
  | 'challenge_expired'
  | 'challenge_consumed'
  | 'verification_failed'
  | 'origin_mismatch';

export type FinishRegistrationResult =
  | { ok: true; credential: RegistrationResult }
  | { ok: false; reason: FinishRegistrationFailureReason };

export interface FinishRegistrationInput {
  response: RegistrationResponseJSON;
  expectedRPID: string;
  expectedOrigin: string | string[];
  challengeStore: ChallengeStore;
  now?: () => number;
}

export async function finishRegistration(
  input: FinishRegistrationInput,
): Promise<FinishRegistrationResult> {
  // Extract challenge from clientDataJSON (base64url → JSON → challenge field)
  let challenge: string;
  try {
    const raw = Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8');
    ({ challenge } = JSON.parse(raw) as { challenge: string });
  } catch {
    return { ok: false, reason: 'challenge_invalid' };
  }

  // Validate before consuming (single-threaded JS — no race hazard)
  const record = await input.challengeStore.get(challenge);
  if (!record) return { ok: false, reason: 'challenge_invalid' };
  if (record.consumed) return { ok: false, reason: 'challenge_consumed' };

  const now = input.now?.() ?? Date.now();
  if (record.expiresAt < now) return { ok: false, reason: 'challenge_expired' };

  await input.challengeStore.consume(challenge);

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedRPID: input.expectedRPID,
      expectedOrigin: input.expectedOrigin,
    });
  } catch (err) {
    if (err instanceof Error && /origin/i.test(err.message)) {
      return { ok: false, reason: 'origin_mismatch' };
    }
    return { ok: false, reason: 'verification_failed' };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: 'verification_failed' };
  }

  const { registrationInfo } = verification;
  return {
    ok: true,
    credential: {
      credentialId: registrationInfo.credentialID,
      // Store COSE-encoded public key bytes as base64; passed back to verifyAuthenticationResponse later
      publicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64'),
      signCount: registrationInfo.counter,
      aaguid: registrationInfo.aaguid,
      transports: input.response.response.transports as string[] | undefined,
    },
  };
}

export interface StartAssertionInput {
  userId: string;
  rpId: string;
  allowCredentials?: { id: string; type: 'public-key' }[];
  userVerification: 'required' | 'preferred' | 'discouraged';
  challengeStore: ChallengeStore;
  now?: () => number;
}

export async function startAssertion(
  input: StartAssertionInput,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const challengeBytes = randomBytes(32);
  const challenge = Buffer.from(challengeBytes).toString('base64url');
  const now = input.now?.() ?? Date.now();

  await input.challengeStore.put({
    challenge,
    userId: input.userId,
    purpose: 'assertion',
    rpId: input.rpId,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    consumed: false,
  });

  return generateAuthenticationOptions({
    rpID: input.rpId,
    challenge: challengeBytes,
    allowCredentials: input.allowCredentials?.map(c => ({ id: c.id })),
    userVerification: input.userVerification,
  });
}

export type FinishAssertionFailureReason =
  | 'challenge_invalid'
  | 'challenge_expired'
  | 'challenge_consumed'
  | 'verification_failed'
  | 'origin_mismatch'
  | 'signcount_replay';

export type FinishAssertionResult =
  | { ok: true; signCount: number; credentialId: string }
  | { ok: false; reason: FinishAssertionFailureReason };

export interface FinishAssertionInput {
  response: AuthenticationResponseJSON;
  expectedRPID: string;
  expectedOrigin: string | string[];
  storedPublicKey: string;    // base64-encoded COSE key from RegistrationResult.publicKey
  storedSignCount: number;
  challengeStore: ChallengeStore;
  now?: () => number;
}

export async function finishAssertion(
  input: FinishAssertionInput,
): Promise<FinishAssertionResult> {
  let challenge: string;
  try {
    const raw = Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8');
    ({ challenge } = JSON.parse(raw) as { challenge: string });
  } catch {
    return { ok: false, reason: 'challenge_invalid' };
  }

  const record = await input.challengeStore.get(challenge);
  if (!record) return { ok: false, reason: 'challenge_invalid' };
  if (record.consumed) return { ok: false, reason: 'challenge_consumed' };

  const now = input.now?.() ?? Date.now();
  if (record.expiresAt < now) return { ok: false, reason: 'challenge_expired' };

  await input.challengeStore.consume(challenge);

  const authenticator: AuthenticatorDevice = {
    credentialID: input.response.id,
    // Defensive (PFL-094): accept both base64 and base64url. PFL-094 wrote
    // these bytes via `Buffer.from(cose).toString('base64')`, so this path
    // will always see classic base64 today. The replace() handles any
    // other caller that encoded the stored COSE key URL-safe — Node's
    // 'base64' mode tolerates `-`/`_` since Node 16, but be explicit so a
    // future strict environment doesn't silently break assertion verify.
    credentialPublicKey: Buffer.from(
      input.storedPublicKey.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ),
    counter: input.storedSignCount,
  };

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedRPID: input.expectedRPID,
      expectedOrigin: input.expectedOrigin,
      authenticator,
    });
  } catch (err) {
    if (err instanceof Error && /origin/i.test(err.message)) {
      return { ok: false, reason: 'origin_mismatch' };
    }
    return { ok: false, reason: 'verification_failed' };
  }

  if (!verification.verified) {
    return { ok: false, reason: 'verification_failed' };
  }

  const { newCounter } = verification.authenticationInfo;
  // Reject backward counters (replay attack); exception: authenticator permanently returns 0
  const isReplay = !(newCounter === 0 && input.storedSignCount === 0) && newCounter <= input.storedSignCount;
  if (isReplay) return { ok: false, reason: 'signcount_replay' };

  return {
    ok: true,
    signCount: newCounter,
    credentialId: input.response.id,
  };
}
