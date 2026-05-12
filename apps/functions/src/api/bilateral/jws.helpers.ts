/**
 * @file jws.helpers.ts
 * @module apps/functions/src/api/bilateral
 *
 * Build and verify the signed JWS token embedded in the counterparty
 * deep-link URL per TDD §11.2.
 *
 * Token format: a compact JWS (HS256, shared secret from env) with claims:
 *   { sub: docId, iss: "proofline-bilateral", exp: expiresAt, drafterId: companyId }
 *
 * The token is the auth on /sign-as-counterparty — no Firebase auth required.
 * Secret comes from BILATERAL_JWT_SECRET env var.
 */

import * as crypto from "node:crypto";

const SECRET = process.env["BILATERAL_JWT_SECRET"] ?? "dev-secret-change-in-prod";

// ─── Build ────────────────────────────────────────────────────────────────────

export async function buildCounterpartyJwsLink(opts: {
  baseUrl:          string;
  docId:            string;
  drafterCompanyId: string;
  expiresAt:        number;
}): Promise<string> {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub:       opts.docId,
    iss:       "proofline-bilateral",
    exp:       opts.expiresAt,
    drafterId: opts.drafterCompanyId,
  }));

  const sigInput = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(sigInput)
    .digest("base64url");

  const token = `${sigInput}.${sig}`;
  return `${opts.baseUrl}/b/${encodeURIComponent(opts.docId)}?t=${encodeURIComponent(token)}`;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

interface VerifyOk {
  ok:        true;
  docId:     string;
  drafterId: string;
  exp:       number;
}

interface VerifyFail {
  ok:     false;
  detail: string;
}

export async function verifyCounterpartyJwsToken(
  token: string,
): Promise<VerifyOk | VerifyFail> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, detail: "Malformed token" };
  }

  const [header, payload, sig] = parts as [string, string, string];
  const expectedSig = crypto
    .createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks.
  const sigBuf      = Buffer.from(sig,         "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { ok: false, detail: "Invalid token signature" };
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, detail: "Token payload is not valid JSON" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims["exp"] === "number" && claims["exp"] < nowSec) {
    return { ok: false, detail: "Token has expired" };
  }

  if (claims["iss"] !== "proofline-bilateral") {
    return { ok: false, detail: "Invalid token issuer" };
  }

  return {
    ok:        true,
    docId:     String(claims["sub"]),
    drafterId: String(claims["drafterId"]),
    exp:       Number(claims["exp"]),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}