/**
 * @file verify-assertion.ts
 * @module apps/functions/src/webauthn
 *
 * Shared server-side WebAuthn assertion verification (PFL-182).
 *
 * Extracted from the cosign finalize handler (PFL-171) so the bilateral
 * counterparty ceremony verifies assertions exactly the same way: the
 * client-posted assertion is checked against the credential's registered
 * public key and the server-issued challenge, for a given RP id + origins.
 * Nothing is ever accepted unverified.
 */

import { finishAssertion, InMemoryChallengeStore } from "@proofline/webauthn";

export interface AssertionCredential {
  userId?:    string;
  companyId?: string;
  publicKey?: string;
}

export interface VerifyAssertionResult {
  ok:      boolean;
  reason?: string;
}

/** Pulls the credential id out of the client-posted assertion (id ?? credentialId). */
export function extractCredentialId(assertion: unknown): string | null {
  if (!assertion || typeof assertion !== "object") return null;
  const a = assertion as Record<string, unknown>;
  const id = (a["credentialId"] ?? a["id"]) as string | undefined;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Pulls the raw base64url signature out of the assertion (top-level or nested). */
export function extractSig(assertion: unknown): string {
  if (!assertion || typeof assertion !== "object") return "";
  const a = assertion as Record<string, unknown>;
  const direct = a["signature"];
  if (typeof direct === "string") return direct;
  const resp = a["response"];
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (typeof r["signature"] === "string") return r["signature"] as string;
  }
  return "";
}

/** The clientDataJSON / authenticatorData artifacts, for persisting on the signer entry. */
export function extractAssertionArtifacts(assertion: unknown): {
  clientDataJSON: string;
  authenticatorData: string;
} {
  const resp =
    assertion && typeof assertion === "object"
      ? ((assertion as { response?: Record<string, unknown> }).response ?? {})
      : {};
  return {
    clientDataJSON:    String(resp["clientDataJSON"] ?? ""),
    authenticatorData: String(resp["authenticatorData"] ?? ""),
  };
}

function adaptAssertionForFinish(
  assertion: unknown,
): Parameters<typeof finishAssertion>[0]["response"] | null {
  if (!assertion || typeof assertion !== "object") return null;
  const a = assertion as Record<string, unknown>;
  const id = (a["id"] ?? a["credentialId"]) as string | undefined;
  const inner = a["response"];
  if (!id || !inner || typeof inner !== "object") return null;
  const r = inner as Record<string, unknown>;
  if (
    typeof r["clientDataJSON"] !== "string" ||
    typeof r["authenticatorData"] !== "string" ||
    typeof r["signature"] !== "string"
  ) {
    return null;
  }
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: r["clientDataJSON"] as string,
      authenticatorData: r["authenticatorData"] as string,
      signature: r["signature"] as string,
      ...(typeof r["userHandle"] === "string" ? { userHandle: r["userHandle"] as string } : {}),
    },
  } as Parameters<typeof finishAssertion>[0]["response"];
}

/**
 * Verifies a client-posted WebAuthn assertion against the credential's stored
 * public key and the server-issued `challenge`, for the given RP id and the
 * allowed origins. Returns `{ ok: false, reason }` on any problem — callers
 * must treat anything other than `ok: true` as a rejection.
 */
export async function verifyWebAuthnAssertion(opts: {
  challenge:    string;
  assertion:    unknown;
  credentialId: string | null;
  credential:   AssertionCredential | null;
  rpId:         string;
  origins:      string[];
}): Promise<VerifyAssertionResult> {
  const { challenge, assertion, credentialId, credential, rpId, origins } = opts;
  try {
    if (!credentialId) return { ok: false, reason: "NO_CREDENTIAL_ID" };
    if (!credential)   return { ok: false, reason: "CREDENTIAL_NOT_FOUND" };
    const publicKey = credential.publicKey;
    if (typeof publicKey !== "string") return { ok: false, reason: "PUBKEY_MISSING" };

    const response = adaptAssertionForFinish(assertion);
    if (!response) return { ok: false, reason: "ASSERTION_SHAPE_INVALID" };

    const challengeStore = new InMemoryChallengeStore();
    const now = Date.now();
    await challengeStore.put({
      challenge,
      userId: "",
      purpose: "assertion",
      rpId,
      createdAt: now,
      expiresAt: now + 60_000,
      consumed: false,
    });

    const result = await finishAssertion({
      response,
      expectedRPID: rpId,
      expectedOrigin: origins,
      storedPublicKey: publicKey,
      storedSignCount: 0,
      challengeStore,
    });
    return { ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "VERIFY_THREW" };
  }
}
