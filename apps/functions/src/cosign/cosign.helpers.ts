/**
 * @file cosign.helpers.ts
 * @module apps/functions/src/cosign
 *
 * Shared helpers for the three cosign handlers. Kept in one file because
 * the surface is small and tests can mock individual functions.
 */

import * as crypto from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { CosignSignerInfo } from "./cosign.types.js";

// ─── JWS decode (structural — no signature check) ────────────────────────────
//
// TODO(PFL-COSIGN-KMS): once company root keys live in Cloud KMS, switch
// to verifying the JWS signature with the public key referenced by `kid`.
// For the hackathon slice, we decode header + claims and check `exp`.

export interface CosignClaims {
  iss:         string;         // companyId of the original signer's company
  sub:         string;         // messageId
  payloadHash: string;         // sha256 hex of canonical payload bytes
  iat:         number;         // unix seconds
  exp:         number;         // unix seconds
  kid?:        string;         // company root key id (future use)
}

export interface DecodeOk   { ok: true;  claims: CosignClaims; }
export interface DecodeFail { ok: false; reason: "MALFORMED" | "EXPIRED" | "CLAIM_MISSING"; }

export function decodeCosignJws(token: string): DecodeOk | DecodeFail {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "MALFORMED" };

  let claimsRaw: unknown;
  try {
    const payloadB64 = parts[1] as string;
    claimsRaw = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (!claimsRaw || typeof claimsRaw !== "object") {
    return { ok: false, reason: "MALFORMED" };
  }
  const c = claimsRaw as Record<string, unknown>;
  if (
    typeof c["iss"]         !== "string" ||
    typeof c["sub"]         !== "string" ||
    typeof c["payloadHash"] !== "string" ||
    typeof c["iat"]         !== "number" ||
    typeof c["exp"]         !== "number"
  ) {
    return { ok: false, reason: "CLAIM_MISSING" };
  }

  const now = Math.floor(Date.now() / 1000);
  if ((c["exp"] as number) < now) {
    return { ok: false, reason: "EXPIRED" };
  }

  const claims: CosignClaims = {
    iss:         c["iss"]         as string,
    sub:         c["sub"]         as string,
    payloadHash: c["payloadHash"] as string,
    iat:         c["iat"]         as number,
    exp:         c["exp"]         as number,
    ...(typeof c["kid"] === "string" ? { kid: c["kid"] as string } : {}),
  };
  return { ok: true, claims };
}

// ─── JWS mint (HS256 against a refresh secret) ───────────────────────────────
//
// Used by the refresh endpoint. The original sign flow issues JWS via
// company KMS; refresh re-issues with the same structural shape but a
// hackathon HMAC. Once KMS lands, both paths converge.

function getRefreshSecret(): string {
  return process.env["COSIGN_REFRESH_SECRET"] ?? "dev-cosign-refresh-secret-change-in-prod";
}

export function mintCosignJws(claims: CosignClaims): string {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto
    .createHmac("sha256", getRefreshSecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

// ─── Stored envelope → wire SignedEnvelope ───────────────────────────────────
//
// sign-finalize.handler.ts persists envelopes in a local EmailSignedEnvelope
// shape (`signatures`, `status`, `createdAt`, no `v`/`payloadType`/anchor
// fields). The cosign client expects the canonical SignedEnvelope schema
// (`signers`, `v`, `payloadType`, `anchorRoot`...). This adapter bridges
// both — newer envelopes already in canonical shape pass through verbatim.

interface StoredSigner {
  signerId?:     string;
  userId?:       string;
  credentialId:  string;
  sig:           string;
  signedAt:      number;
  sessionId?:    string | null;
  role?:         string;
  path?:         "fresh" | "silent";
}

interface StoredEnvelope {
  v?:                  number;
  payloadType?:        "wire" | "email" | "bilateral";
  payload:             unknown;
  payloadHash:         string;
  signers?:            StoredSigner[];
  signatures?:         StoredSigner[];
  status?:             string;
  anchorRoot?:         string | null;
  anchorTxHash?:       string | null;
  anchorBlockNumber?:  number | null;
  envelopeId?:         string;
}

export interface AdaptedEnvelope {
  v:                 1;
  payloadType:       "wire" | "email" | "bilateral";
  payload:           unknown;
  payloadHash:       string;
  signers: Array<{
    userId:       string;
    credentialId: string;
    role:         string;
    sig:          string;
    signedAt:     number;
    sessionId:    string | null;
  }>;
  anchorRoot:        string | null;
  anchorTxHash:      string | null;
  anchorBlockNumber: number | null;
}

export function adaptStoredEnvelope(raw: StoredEnvelope): AdaptedEnvelope {
  const rawSigners = raw.signers ?? raw.signatures ?? [];
  const signers = rawSigners.map((s) => ({
    userId:       s.userId    ?? s.signerId ?? "",
    credentialId: s.credentialId,
    role:         s.role      ?? "signer",
    sig:          s.sig,
    signedAt:     s.signedAt,
    sessionId:    s.sessionId ?? null,
  }));

  // Best-effort payloadType inference when the stored doc predates it.
  const inferredType: "wire" | "email" | "bilateral" =
    raw.payloadType ??
    (looksLikeWire(raw.payload)
      ? "wire"
      : looksLikeBilateral(raw.payload)
      ? "bilateral"
      : "email");

  return {
    v:                 1,
    payloadType:       inferredType,
    payload:           raw.payload,
    payloadHash:       raw.payloadHash,
    signers,
    anchorRoot:        raw.anchorRoot        ?? null,
    anchorTxHash:      raw.anchorTxHash      ?? null,
    anchorBlockNumber: raw.anchorBlockNumber ?? null,
  };
}

function looksLikeWire(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p["amount"] === "number" && typeof p["recipientAccount"] === "string";
}

function looksLikeBilateral(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p["docId"] === "string" || typeof p["counterpartyId"] === "string";
}

// ─── CosignSignerInfo resolution ─────────────────────────────────────────────
//
// Looks up the *first* signer's display info from users/{uid} + companies/
// {companyId}. Falls back to safe defaults so the response always renders.

export async function resolveCosignSignerInfo(
  envelope: AdaptedEnvelope,
  firestore: Firestore = getFirestore(),
): Promise<CosignSignerInfo> {
  const first = envelope.signers[0];
  if (!first) {
    return {
      userId:           "",
      credentialId:     "",
      signedAt:         0,
      userDisplayName:  "Unknown signer",
      companyId:        "",
      companyDomain:    "",
      companyLegalName: "",
    };
  }

  let displayName = first.userId;
  let companyId   = "";
  let domain      = "";
  let legalName   = "";

  try {
    const userSnap = await firestore.collection("users").doc(first.userId).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      displayName = (u["displayName"] as string | undefined) ?? displayName;
      companyId   = (u["companyId"]   as string | undefined) ?? "";
    }
    if (companyId) {
      const coSnap = await firestore.collection("companies").doc(companyId).get();
      if (coSnap.exists) {
        const c = coSnap.data() as Record<string, unknown>;
        domain    = (c["domain"]    as string | undefined) ?? "";
        legalName = (c["legalName"] as string | undefined) ?? "";
      }
    }
  } catch {
    // Firestore failures here should not crash the cosign read path —
    // we'd rather return a sparse signer than 500.
  }

  return {
    userId:           first.userId,
    credentialId:     first.credentialId,
    signedAt:         first.signedAt,
    userDisplayName:  displayName,
    companyId,
    companyDomain:    domain,
    companyLegalName: legalName,
  };
}

// ─── Already-cosigned detection ──────────────────────────────────────────────

export function hasCosigner(envelope: AdaptedEnvelope): boolean {
  // The first signer is the original; anything beyond is a cosignature.
  return envelope.signers.length > 1;
}

// ─── WebAuthn challenge bytes ────────────────────────────────────────────────

export function newCosignChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}
