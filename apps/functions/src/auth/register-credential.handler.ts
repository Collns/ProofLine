/**
 * @file register-credential.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/extension/register-credential — store a freshly-created
 * WebAuthn credential for an authenticated user (PFL-069).
 *
 * Auth: Bearer JWS issued by /v1/extension/auth (PFL-061). We verify
 * structure + HMAC + exp against PROOFLINE_AUTH_JWT_SECRET so a stolen
 * sign-flow Bearer can't be used to enroll a credential for someone else.
 *
 * Body: { credentialId, publicKey, attestationObject, clientDataJSON }
 *   All four are base64url strings produced by the browser:
 *     credentialId       = base64url(rawId)
 *     publicKey          = base64url(response.getPublicKey())  // SPKI bytes
 *                          NOTE (PFL-094): the client still sends this for
 *                          backward compatibility, but the server IGNORES
 *                          the value. SimpleWebAuthn's assertion verifier
 *                          requires COSE-encoded keys, not SPKI — so we
 *                          extract COSE from attestationObject below and
 *                          store THAT as the canonical publicKey.
 *     attestationObject  = base64url(response.attestationObject)
 *     clientDataJSON     = base64url(response.clientDataJSON)
 *
 * Side effects (idempotent under same credentialId):
 *   webauthn_credentials/{credentialId} = { userId, companyId, publicKey,
 *                                           attestationObject, clientDataJSON,
 *                                           deviceName, createdAt }
 *                                          publicKey is now COSE (base64) — see
 *                                          PFL-094 note above.
 *   users/{userId}.devices[]            = append DeviceRecord for this
 *                                          credentialId if not already
 *                                          present (PFL-084). The canonical
 *                                          schema is `User.devices: DeviceRecord[]`
 *                                          and validatePolicy/sign-finalize
 *                                          both look up devices via
 *                                          `user.devices.find(...)`. We do NOT
 *                                          write a flat `user.credentialId`.
 *
 * Attestation verification IS performed here (PFL-094) — `verifyRegistrationResponse`
 * from @simplewebauthn/server parses the attestationObject and gives us the
 * COSE public key bytes.
 *
 * Replay defence (PFL-095): the challenge in clientDataJSON MUST match a
 * record in `pending_challenges` issued by POST /v1/auth/challenge for the
 * same userId. The lookup is transactional read+delete (single-use), and
 * the record carries a 5-minute TTL. Missing record → 400 CHALLENGE_INVALID;
 * stale record → 400 CHALLENGE_EXPIRED. The attestation is only fed to
 * verifyRegistrationResponse AFTER the challenge has been validated and
 * consumed.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import * as crypto from "node:crypto";
import { verifyRegistrationResponse } from "@simplewebauthn/server";

import type { DeviceRecord } from "@proofline/types";
import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";
import {
  REGISTRATION_CHALLENGE_PURPOSE,
  type PendingRegistrationChallenge,
} from "./registration-challenge.handler.js";

// ─── Auth: decode + verify the extension auth JWS ────────────────────────────

interface DecodedAuthToken {
  userId:       string;
  companyId:    string;
  extInstallId: string;
  iat:          number;
  exp:          number;
}

function getSecret(): string {
  return (process.env["PROOFLINE_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod").trim();
}

function verifyAuthBearer(bearer: string): DecodedAuthToken | null {
  if (!bearer.startsWith("Bearer ")) return null;
  const token = bearer.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
  const sigBuf = Buffer.from(sig,      "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    typeof claims["userId"]       !== "string" ||
    typeof claims["companyId"]    !== "string" ||
    typeof claims["extInstallId"] !== "string" ||
    typeof claims["iat"]          !== "number" ||
    typeof claims["exp"]          !== "number"
  ) {
    return null;
  }
  if ((claims["exp"] as number) < Math.floor(Date.now() / 1000)) return null;
  return {
    userId:       claims["userId"]       as string,
    companyId:    claims["companyId"]    as string,
    extInstallId: claims["extInstallId"] as string,
    iat:          claims["iat"]          as number,
    exp:          claims["exp"]          as number,
  };
}

// ─── Request schema ──────────────────────────────────────────────────────────

const RegisterCredentialBodySchema = z.object({
  credentialId:      z.string().min(1, "credentialId is required"),
  publicKey:         z.string().min(1, "publicKey is required"),
  attestationObject: z.string().min(1, "attestationObject is required"),
  clientDataJSON:    z.string().min(1, "clientDataJSON is required"),
  deviceName:        z.string().optional(),
});

export interface RegisterCredentialResponse {
  ok:           true;
  credentialId: string;
}

// ─── COSE-from-attestation extraction (PFL-094) ─────────────────────────────
//
// SimpleWebAuthn's assertion verifier requires the COSE-encoded public key
// (CBOR map, byte prefix 0xa5 …). The browser's `response.getPublicKey()`
// returns SPKI/DER (ASN.1, byte prefix 0x30 0x59 …). Same EC P-256 key,
// completely different binary encodings — verifyAuthenticationResponse
// returns false when fed SPKI.
//
// To get the right bytes we hand the attestationObject (which the client
// already sends) to `verifyRegistrationResponse`. The library parses the
// CBOR-encoded authenticatorData inside, and returns
// `registrationInfo.credentialPublicKey` as raw COSE bytes. We base64-
// encode those and store them as the canonical `publicKey` everywhere.
//
// CHALLENGE HANDLING (PFL-095):
//
// We parse `challenge` out of clientDataJSON BEFORE calling
// `verifyRegistrationResponse`, but only to look it up in
// `pending_challenges` (a server-issued, single-use record from POST
// /v1/auth/challenge). If the lookup fails we reject the request with
// CHALLENGE_INVALID / CHALLENGE_EXPIRED — so by the time the bytes get
// to verifyRegistrationResponse below, we already know the server
// issued the challenge for THIS user. The expectedChallenge passed into
// the verifier is the same bytes the browser signed, which keeps the
// SimpleWebAuthn structural check happy without trusting client-supplied
// values for replay defence.

function extractChallengeFromClientDataJSON(b64url: string): string {
  const json = Buffer.from(b64url, "base64url").toString("utf8");
  const parsed = JSON.parse(json) as { challenge: string };
  return parsed.challenge;
}

// ─── Default COSE extractor (calls SimpleWebAuthn) ──────────────────────────

export interface CoseExtractInput {
  credentialId:      string;
  attestationObject: string;
  clientDataJSON:    string;
}

export type CoseExtractResult =
  | { ok: true;  coseB64: string }
  | { ok: false; reason: string };

async function defaultExtractCose(input: CoseExtractInput): Promise<CoseExtractResult> {
  // PFL-095: the challenge is now sourced from the server-side
  // pending_challenges record (looked up + consumed in the handler before
  // calling us). The clientDataJSON value is parsed too, only so we can
  // hand verifyRegistrationResponse the exact bytes the browser signed —
  // the AUTHORITATIVE comparison (did the server issue this challenge?)
  // already happened upstream.
  let expectedChallenge: string;
  try {
    expectedChallenge = extractChallengeFromClientDataJSON(input.clientDataJSON);
  } catch {
    return { ok: false, reason: "Malformed clientDataJSON — cannot extract challenge" };
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: {
        id:                     input.credentialId,
        rawId:                  input.credentialId,
        type:                   "public-key",
        response: {
          attestationObject: input.attestationObject,
          clientDataJSON:    input.clientDataJSON,
        },
        clientExtensionResults: {},
      } as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge,
      expectedRPID:            "proofline-sign.web.app",
      expectedOrigin:          "https://proofline-sign.web.app",
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false, reason: "Could not verify the attestation object" };
    }

    return {
      ok:      true,
      coseB64: Buffer.from(verification.registrationInfo.credentialPublicKey).toString("base64"),
    };
  } catch (err) {
    return {
      ok:     false,
      reason: err instanceof Error ? err.message : "Attestation verification failed",
    };
  }
}

// ─── Server-issued challenge consumption (PFL-095) ──────────────────────────
//
// Transactional read-then-delete against `pending_challenges`. Single-use:
// once a challenge is consumed it can never satisfy another registration
// (or sign) request. Expired records are deleted on access — we don't rely
// on Firestore TTL alone because in-band cleanup keeps the collection
// small for the demo and removes the expired record's data eagerly.

async function defaultConsumeRegistrationChallenge(input: {
  challenge: string;
  userId:    string;
}): Promise<ChallengeConsumeResult> {
  const db = getFirestore();
  const snap = await db
    .collection("pending_challenges")
    .where("challenge", "==", input.challenge)
    .limit(1)
    .get();

  if (snap.empty) {
    return {
      ok:     false,
      code:   "CHALLENGE_INVALID",
      detail: "Challenge not found — request a new one via POST /v1/auth/challenge",
    };
  }

  const docSnap = snap.docs[0];
  const record  = docSnap.data() as PendingRegistrationChallenge;

  return db.runTransaction(async (tx) => {
    const ref   = docSnap.ref;
    const fresh = await tx.get(ref);
    if (!fresh.exists) {
      return {
        ok:     false,
        code:   "CHALLENGE_INVALID",
        detail: "Challenge already consumed",
      } as const;
    }

    // Always delete: even if validation below rejects, the challenge has
    // been observed by the world (it was in clientDataJSON) and we never
    // want to give an attacker a second swing at it.
    tx.delete(ref);

    if (record.purpose !== REGISTRATION_CHALLENGE_PURPOSE) {
      return {
        ok:     false,
        code:   "CHALLENGE_INVALID",
        detail: `Challenge purpose is ${String(record.purpose)}, expected registration`,
      } as const;
    }
    if (record.userId !== input.userId) {
      return {
        ok:     false,
        code:   "CHALLENGE_INVALID",
        detail: "Challenge does not belong to the authenticated user",
      } as const;
    }
    if (record.expiresAt < Date.now()) {
      return {
        ok:     false,
        code:   "CHALLENGE_EXPIRED",
        detail: "Challenge expired — request a new one via POST /v1/auth/challenge",
      } as const;
    }

    return { ok: true, record } as const;
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export type ChallengeConsumeResult =
  | { ok: true; record: PendingRegistrationChallenge }
  | { ok: false; code: "CHALLENGE_INVALID" | "CHALLENGE_EXPIRED"; detail: string };

export interface RegisterCredentialHandlerDeps {
  /** Injectable for tests; defaults to the HMAC JWS decoder above. */
  verifyAuthBearer?: (bearer: string) => DecodedAuthToken | null;
  /**
   * Override the COSE-from-attestation step for tests that don't supply
   * real attestation bytes. Default: SimpleWebAuthn's
   * verifyRegistrationResponse against the live attestationObject.
   */
  extractCose?: (input: CoseExtractInput) => Promise<CoseExtractResult>;
  /**
   * PFL-095: override how the server-issued registration challenge is
   * looked up and consumed. Default: transactional read+delete from
   * `pending_challenges`. Tests inject this to assert the handler honours
   * CHALLENGE_INVALID / CHALLENGE_EXPIRED without needing a Firestore
   * transaction shim.
   */
  consumeRegistrationChallenge?: (input: {
    challenge: string;
    userId:    string;
  }) => Promise<ChallengeConsumeResult>;
}

export function makeRegisterCredentialHandler(
  deps: RegisterCredentialHandlerDeps = {},
) {
  const verify     = deps.verifyAuthBearer ?? verifyAuthBearer;
  const extractCose = deps.extractCose      ?? defaultExtractCose;
  const consumeRegistrationChallenge =
    deps.consumeRegistrationChallenge ?? defaultConsumeRegistrationChallenge;

  return async function registerCredentialHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    // 1. Bearer auth.
    const bearer = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    if (!bearer) {
      res.status(401).json(ERR.unauthorized("Missing Authorization header"));
      return;
    }
    const decoded = verify(bearer);
    if (!decoded) {
      res.status(401).json(ERR.unauthorized("Invalid or expired auth token"));
      return;
    }

    // 2. Body parse.
    const parsed = RegisterCredentialBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const body = parsed.data;

    // 3. Idempotency: if this credentialId is already stored under the
    //    SAME userId, treat as success. If owned by a different user,
    //    refuse with 409 — we don't want to silently transfer a credential.
    const firestore = getFirestore();
    const credRef   = firestore.collection("webauthn_credentials").doc(body.credentialId);
    const credSnap  = await credRef.get();
    if (credSnap.exists) {
      const existing = credSnap.data() as { userId?: string };
      if (existing.userId && existing.userId !== decoded.userId) {
        res.status(409).json(
          ERR.conflict(
            "CREDENTIAL_ALREADY_REGISTERED",
            "This credential is already registered to a different account",
          ),
        );
        return;
      }
      // Same-user re-registration — return success without re-writing.
      res.status(200).json({ ok: true, credentialId: body.credentialId } satisfies RegisterCredentialResponse);
      return;
    }

    // 4. PFL-095: consume the server-issued registration challenge.
    //    Parse `challenge` out of clientDataJSON, then look it up in
    //    pending_challenges and atomically delete it. CHALLENGE_INVALID
    //    (unknown / mismatched user / wrong purpose) or CHALLENGE_EXPIRED
    //    are 400s — never 500s, since the request body itself is well-
    //    formed. The downstream verifyRegistrationResponse call still re-
    //    parses clientDataJSON for its own check; this consume step is the
    //    authoritative replay-defence.
    let challengeFromClient: string;
    try {
      challengeFromClient = extractChallengeFromClientDataJSON(body.clientDataJSON);
    } catch {
      res.status(400).json(
        makeRFC7807Error(
          "https://proofline.app/errors/CHALLENGE_INVALID",
          "CHALLENGE_INVALID",
          400,
          "clientDataJSON did not contain a parseable challenge",
        ),
      );
      return;
    }
    const challengeResult = await consumeRegistrationChallenge({
      challenge: challengeFromClient,
      userId:    decoded.userId,
    });
    if (!challengeResult.ok) {
      res.status(400).json(
        makeRFC7807Error(
          `https://proofline.app/errors/${challengeResult.code}`,
          challengeResult.code,
          400,
          challengeResult.detail,
        ),
      );
      return;
    }

    // 5. Verify the attestation and extract COSE public key bytes (PFL-094).
    //    The client-supplied `body.publicKey` is SPKI/DER and incompatible
    //    with SimpleWebAuthn's assertion verifier — we ignore it and pull
    //    the COSE-encoded key out of the attestationObject instead via
    //    the injected extractor (default uses verifyRegistrationResponse).
    if (body.publicKey) {
      // eslint-disable-next-line no-console
      console.warn(
        "[register-credential] received body.publicKey (SPKI) for credential " +
          `${body.credentialId.slice(0, 16)}… — ignoring; storing COSE from attestationObject instead`,
      );
    }

    const coseResult = await extractCose({
      credentialId:      body.credentialId,
      attestationObject: body.attestationObject,
      clientDataJSON:    body.clientDataJSON,
    });

    if (!coseResult.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[register-credential] attestation rejected: ${coseResult.reason}`);
      res.status(400).json(
        makeRFC7807Error(
          "https://proofline.app/errors/ATTESTATION_INVALID",
          "ATTESTATION_INVALID",
          400,
          coseResult.reason,
        ),
      );
      return;
    }

    const coseB64 = coseResult.coseB64;

    // 5. Store credential — `publicKey` is now COSE bytes (base64), not SPKI.
    //
    //    PFL-100: we also write a parallel doc to
    //    users/{userId}/role_credentials/{credentialId} so the verify
    //    pipeline's `RegistryView.getUserCredential` (collectionGroup
    //    query on role_credentials) can resolve this credential at
    //    verify time. Sign-time and verify-time crypto take DIFFERENT
    //    encodings of the same EC P-256 key:
    //      - sign-time @simplewebauthn assertion verifier → COSE base64
    //      - verify-time @proofline/crypto.verifyEcdsaP256 → SPKI base64
    //    So we keep COSE in webauthn_credentials.publicKey and SPKI in
    //    role_credentials.publicKey. The browser already sends both
    //    forms; body.publicKey (base64url) is SPKI from response.getPublicKey()
    //    and we just re-encode to plain base64 for the role_credentials doc.
    //
    //    HACKATHON CAVEAT — issuerSig: the verify pipeline checks
    //    `verifyEcdsaP256(company.rootPublicKey, canonicalize(credentialFields),
    //    credential.issuerSig)` at packages/verification/src/checks.ts:117.
    //    We don't yet have company-root signing infrastructure, so issuerSig
    //    is stored as "". Verification will fail with ROLE_CREDENTIAL_INVALID
    //    until that lands. TODO(PFL-100.1): sign role credentials with the
    //    company root key at registration time.
    const now = Date.now();

    const userRef  = firestore.collection("users").doc(decoded.userId);
    const userSnap = await userRef.get();
    const existingUser = userSnap.exists
      ? (userSnap.data() as {
          role?: "owner" | "manager" | "employee";
          devices?: DeviceRecord[];
          wireLimitUsd?: number;
          dailyLimitUsd?: number;
        })
      : null;
    const userRole = existingUser?.role ?? "owner";

    const spkiBase64 = Buffer.from(body.publicKey, "base64url").toString("base64");
    const roleCredRef = userRef.collection("role_credentials").doc(body.credentialId);

    const credDoc = {
      credentialId:      body.credentialId,
      userId:            decoded.userId,
      companyId:         decoded.companyId,
      publicKey:         coseB64,
      attestationObject: body.attestationObject,
      clientDataJSON:    body.clientDataJSON,
      deviceName:        body.deviceName ?? "Unknown device",
      createdAt:         now,
    };
    const roleCredDoc = {
      v:                1 as const,
      credentialId:     body.credentialId,
      publicKey:        spkiBase64,
      userId:           decoded.userId,
      companyId:        decoded.companyId,
      role:             userRole,
      perEmailLimitUsd: null,
      dailyLimitUsd:    null,
      issuedAt:         now,
      revokedAt:        null,
      issuerSig:        "",
    };

    const batch = firestore.batch();
    batch.set(credRef,     credDoc);
    batch.set(roleCredRef, roleCredDoc);
    await batch.commit();

    // 6. Append the new device to users/{userId}.devices[].
    //    Idempotent: if a DeviceRecord with this credentialId already
    //    exists on the user, leave it untouched. Multi-device: a new
    //    credentialId is appended, never overwriting prior devices.
    //    (PFL-084: the canonical schema is `User.devices: DeviceRecord[]`;
    //    we do NOT write a flat `users/{userId}.credentialId` field.)
    //    publicKey here is the SAME COSE bytes written above — never the
    //    client's SPKI value.
    const newDevice: DeviceRecord = {
      credentialId: body.credentialId,
      publicKey:    coseB64,
      enrolledAt:   now,
    };
    if (existingUser) {
      const devices = Array.isArray(existingUser.devices) ? existingUser.devices : [];
      if (!devices.some((d) => d.credentialId === body.credentialId)) {
        await userRef.set(
          { devices: [...devices, newDevice], updatedAt: now },
          { merge: true },
        );
      }
    } else {
      // Edge case: user record removed between auth and register. Create
      // a minimal record so /v1/sign* finds something. PFL-088: seed the
      // same policy defaults extension-auth.handler.ts writes on first-
      // auth so this re-created doc has matching wire/daily limits — the
      // user would otherwise hit POLICY_AUTHORITY_EXCEEDED on any wire.
      await userRef.set(
        {
          userId:        decoded.userId,
          companyId:     decoded.companyId,
          role:          "owner",
          status:        "active",
          wireLimitUsd:  500_000,
          dailyLimitUsd: 2_000_000,
          devices:       [newDevice],
          createdAt:     now,
          updatedAt:     now,
        },
        { merge: false },
      );
    }

    const response: RegisterCredentialResponse = {
      ok:           true,
      credentialId: body.credentialId,
    };
    res.status(200).json(response);
  };
}
