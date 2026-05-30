/**
 * @file registration-challenge.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/auth/challenge — issue a server-generated WebAuthn registration
 * challenge (PFL-095).
 *
 * Replaces the prior client-generated-challenge flow. The browser used to
 * generate its own random bytes and the server simply trusted whatever
 * `clientDataJSON.challenge` came back — which made the challenge a
 * decoration rather than a replay defence. With this endpoint:
 *
 *   1. Popup calls POST /v1/auth/challenge with the extension auth Bearer.
 *   2. Server generates 32 random bytes, base64url-encodes them, persists
 *      the record in `pending_challenges/{challengeId}` with a 5-minute
 *      TTL and the calling user's identity bound in.
 *   3. Popup runs navigator.credentials.create() with that challenge.
 *   4. Popup posts the attestation to /v1/extension/register-credential.
 *   5. That handler reads the challenge OUT of clientDataJSON, looks it up
 *      here, verifies the userId matches, deletes the record (single-use),
 *      and only then feeds it to verifyRegistrationResponse.
 *
 * Storage shape (pending_challenges/{challengeId}):
 *   {
 *     challengeId, challenge,        // both base64url, both the same value
 *     userId, companyId,
 *     credentialId,                  // optional — bound when supplied
 *     purpose: "registration",       // disambiguates from sign challenges
 *     createdAt, expiresAt
 *   }
 *
 * The signing flow uses the same `pending_challenges` collection but with
 * `purpose: "sign"` (writes done by signing.helpers.ts). We tag the purpose
 * so register-credential refuses to consume a sign challenge and vice-versa.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import * as crypto from "node:crypto";

import { ERR } from "../api/onboarding/http.helpers.js";
import { verifyExtensionAuthBearer } from "./require-extension-auth.middleware.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** 5 minutes — long enough for the user to tap Touch ID, short enough that
 *  a leaked challenge isn't a replay window. */
export const REGISTRATION_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** The challenge collection is shared with the signing flow; this tag
 *  prevents cross-flow consumption (sign challenge → register, or vice
 *  versa). */
export const REGISTRATION_CHALLENGE_PURPOSE = "registration" as const;

// ─── Request / response shapes ──────────────────────────────────────────────

const RegistrationChallengeRequestSchema = z.object({
  // Optional pre-binding to a specific credentialId. The browser does not
  // know the credentialId until AFTER navigator.credentials.create resolves,
  // so this is usually omitted at challenge time. We accept it for future
  // flows that want stricter binding.
  credentialId: z.string().min(1).optional(),
});

export interface RegistrationChallengeResponse {
  challengeId: string;
  challenge:   string;
  expiresAt:   number;
}

// ─── Persisted record ────────────────────────────────────────────────────────

export interface PendingRegistrationChallenge {
  challengeId: string;
  challenge:   string;
  userId:      string;
  companyId:   string;
  credentialId?: string;
  purpose:     typeof REGISTRATION_CHALLENGE_PURPOSE;
  createdAt:   number;
  expiresAt:   number;
}

// ─── Handler factory ─────────────────────────────────────────────────────────

export interface RegistrationChallengeDeps {
  /** Injected for tests — defaults to crypto.randomBytes(32). */
  randomBytes?: (n: number) => Buffer;
  /** Injected for tests — defaults to the shared HMAC bearer verifier. */
  verifyAuthorization?: typeof verifyExtensionAuthBearer;
  /** Injected for tests — defaults to Date.now. */
  now?: () => number;
}

export function makeRegistrationChallengeHandler(
  deps: RegistrationChallengeDeps = {},
) {
  const randomBytes        = deps.randomBytes        ?? ((n) => crypto.randomBytes(n));
  const verifyAuthorization = deps.verifyAuthorization ?? verifyExtensionAuthBearer;
  const now                = deps.now                ?? (() => Date.now());

  return async function registrationChallengeHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Bearer auth — same JWS the rest of /v1/extension/* requires.
    const authResult = verifyAuthorization(req.headers.authorization);
    if (!authResult.ok) {
      res.status(401).json(ERR.unauthorized(authResult.detail));
      return;
    }

    // 2. Body parse. Body is optional — `{}` is valid.
    const parsed = RegistrationChallengeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }

    // 3. Mint challenge. 32 random bytes is the WebAuthn-recommended size
    //    and matches what the browser was generating client-side before.
    const challenge   = randomBytes(32).toString("base64url");
    const challengeId = randomBytes(16).toString("base64url");
    const issuedAt    = now();
    const expiresAt   = issuedAt + REGISTRATION_CHALLENGE_TTL_MS;

    const record: PendingRegistrationChallenge = {
      challengeId,
      challenge,
      userId:    authResult.claims.userId,
      companyId: authResult.claims.companyId,
      ...(parsed.data.credentialId ? { credentialId: parsed.data.credentialId } : {}),
      purpose:   REGISTRATION_CHALLENGE_PURPOSE,
      createdAt: issuedAt,
      expiresAt,
    };

    await getFirestore()
      .collection("pending_challenges")
      .doc(challengeId)
      .set(record);

    const response: RegistrationChallengeResponse = {
      challengeId,
      challenge,
      expiresAt,
    };
    res.status(200).json(response);
  };
}
