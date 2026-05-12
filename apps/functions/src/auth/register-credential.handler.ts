/**
 * @file register-credential.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/extension/register-credential — store a freshly-created
 * WebAuthn credential for an authenticated user (PFL-069).
 *
 * Auth: Bearer JWS issued by /v1/extension/auth (PFL-061). We verify
 * structure + HMAC + exp against EXT_AUTH_JWT_SECRET so a stolen
 * sign-flow Bearer can't be used to enroll a credential for someone else.
 *
 * Body: { credentialId, publicKey, attestationObject, clientDataJSON }
 *   All four are base64url strings produced by the browser:
 *     credentialId       = base64url(rawId)
 *     publicKey          = base64url(response.getPublicKey())  // SPKI bytes
 *     attestationObject  = base64url(response.attestationObject)
 *     clientDataJSON     = base64url(response.clientDataJSON)
 *
 * Side effects (idempotent under same credentialId):
 *   webauthn_credentials/{credentialId} = { userId, companyId, publicKey,
 *                                           attestationObject, clientDataJSON,
 *                                           deviceName, createdAt }
 *   users/{userId}.credentialId         = credentialId  (set if currently
 *                                                        placeholder/empty)
 *
 * Attestation verification is intentionally NOT performed here — the
 * hackathon slice trusts the platform authenticator to have produced a
 * real assertion. Real attestation lives in a follow-up ticket.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import * as crypto from "node:crypto";

import { ERR } from "../api/onboarding/http.helpers.js";

// ─── Auth: decode + verify the extension auth JWS ────────────────────────────

interface DecodedAuthToken {
  userId:       string;
  companyId:    string;
  extInstallId: string;
  iat:          number;
  exp:          number;
}

function getSecret(): string {
  return process.env["EXT_AUTH_JWT_SECRET"] ?? "dev-ext-auth-secret-change-in-prod";
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

const PLACEHOLDER_CREDENTIAL_ID = "placeholder-credential-id";

// ─── Handler ─────────────────────────────────────────────────────────────────

export interface RegisterCredentialHandlerDeps {
  /** Injectable for tests; defaults to the HMAC JWS decoder above. */
  verifyAuthBearer?: (bearer: string) => DecodedAuthToken | null;
}

export function makeRegisterCredentialHandler(
  deps: RegisterCredentialHandlerDeps = {},
) {
  const verify = deps.verifyAuthBearer ?? verifyAuthBearer;

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

    // 4. Store credential.
    const now = Date.now();
    await credRef.set({
      credentialId:      body.credentialId,
      userId:            decoded.userId,
      companyId:         decoded.companyId,
      publicKey:         body.publicKey,
      attestationObject: body.attestationObject,
      clientDataJSON:    body.clientDataJSON,
      deviceName:        body.deviceName ?? "Unknown device",
      createdAt:         now,
    });

    // 5. Update users/{userId}.credentialId — but only when it's still
    //    the placeholder or empty. Keeps multi-device futures sane: the
    //    'primary' credential isn't quietly overwritten on subsequent
    //    enrolments.
    const userRef  = firestore.collection("users").doc(decoded.userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const u = userSnap.data() as { credentialId?: string };
      if (!u.credentialId || u.credentialId === PLACEHOLDER_CREDENTIAL_ID) {
        await userRef.set(
          { credentialId: body.credentialId, updatedAt: now },
          { merge: true },
        );
      }
    } else {
      // Edge case: user record removed between auth and register. Create
      // a minimal record so /v1/sign* finds something — auth handler
      // already established the demo defaults.
      await userRef.set(
        {
          userId:       decoded.userId,
          companyId:    decoded.companyId,
          credentialId: body.credentialId,
          createdAt:    now,
          updatedAt:    now,
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
