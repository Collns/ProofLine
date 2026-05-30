/**
 * @file signing.helpers.ts
 * @module apps/functions/src/signing
 *
 * Pure + side-effecting helpers used by the three signing handlers.
 * Side-effecting functions are thin wrappers over injected adapters so
 * they can be mocked in tests (TDD Tenet: adapter pattern for external services).
 */

import * as crypto from "crypto";
import { v7 as uuidv7 } from "uuid";
import { getFirestore } from "firebase-admin/firestore";
import { generateKeyPair, type CryptoKey } from "jose";

import {
  CompanyPolicy,
  EmailPayload,
  PolicyContext,
  SessionTokenPayload,
  SigningSession,
  WebAuthnAssertion,
} from "@proofline/types";
import type { SignerDisplayRecord } from "@proofline/email";
import { canonicalize } from "@proofline/canonical";
import { finishAssertion, InMemoryChallengeStore } from "@proofline/webauthn";
import { makeJoseSigner, makeJoseVerifier } from "@proofline/sessions";
import type { SessionTokenPayload as SessionsTokenPayload } from "@proofline/sessions";

// ─── Local envelope type (mirrors signing.types.ts) ───────────────────────────
// The shared SignedEnvelope predates email signing fields — use a local type.

interface EmailSignedEnvelope {
  envelopeId: string;
  status: "SIGNED" | "PENDING_COSIGN" | "COSIGNED";
  signatures: Array<{
    signerId: string;
    credentialId: string;
    sig: string;
    signedAt: number;
    sessionId?: string;
    path: "fresh" | "silent";
    // PFL-125: persist the WebAuthn assertion bytes alongside the sig so
    // verify-time can reconstruct what the authenticator actually signed
    // (authData || sha256(clientDataJSON)) rather than relying on a
    // trust-mode bypass.
    authenticatorData?: string;
    clientDataJSON?:    string;
  }>;
  payload: EmailPayload;
  payloadHash: string;
  createdAt: number;
}

export type { EmailSignedEnvelope };

// ─── Canonical bytes (delegates to @proofline/canonical) ─────────────────────

export function buildCanonicalBytes(payload: EmailPayload): Uint8Array {
  return canonicalize(payload);
}

export function hashPayload(canonicalBytes: Uint8Array): string {
  return crypto.createHash("sha256").update(canonicalBytes).digest("hex");
}

// ─── Session token JWS ────────────────────────────────────────────────────────
//
// HACKATHON STUB: session-token signing/verification uses a lazily-generated
// in-process ES256 keypair. Tokens issued by one function instance will NOT
// verify on another instance, so the silent path is only reliable inside the
// same warm container. The follow-up ticket needs to plumb a persistent key
// (Cloud KMS or Secret Manager) through PolicyContext / DI.

let sessionKeysPromise: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> | undefined;

function getSessionTokenKeys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  if (!sessionKeysPromise) {
    sessionKeysPromise = generateKeyPair("ES256");
  }
  return sessionKeysPromise;
}

export async function verifySessionTokenJWS(
  token: string
): Promise<SessionTokenPayload> {
  const keys = await getSessionTokenKeys();
  const verifier = makeJoseVerifier(keys);
  const result = await verifier.verify(token);
  if (!result.ok) {
    throw new Error(`Session token rejected: ${result.error.code}`);
  }
  // @proofline/sessions stores the recipient-set hash under `recipientSetHash`;
  // @proofline/types names the same field `recipientScope`. Map at the boundary
  // so callers (validatePolicy, sign-finalize) keep using the types-pkg shape.
  const v = result.value;
  return {
    v: v.v,
    sessionId: v.sessionId,
    userId: v.userId,
    companyId: v.companyId,
    recipientScope: v.recipientSetHash,
    iat: v.iat,
    exp: v.exp,
  };
}

export async function issueSessionToken(session: SigningSession): Promise<string> {
  const keys = await getSessionTokenKeys();
  const signer = makeJoseSigner(keys);
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionsTokenPayload = {
    v: 1,
    sessionId: session.sessionId,
    userId: session.userId,
    companyId: session.companyId,
    recipientSetHash: session.recipientSetHash,
    iat: nowSec,
    exp: Math.floor(session.expiresAt / 1000),
  };
  return signer.sign(payload);
}

// ─── Pending challenge store ──────────────────────────────────────────────────

export interface PendingChallenge {
  challengeId: string;
  payloadHash: string;
  recipientSetHash: string;
  credentialId: string;
  userId: string;
  companyId: string;
  path: "fresh" | "silent";
  sessionId?: string;
  expiresAt: number;
  // Required: finalize re-runs validatePolicy and rebuilds canonical bytes,
  // both of which need the full payload. Omitting it caused PFL-sign-finalize-500.
  payload: EmailPayload;
}

export async function storePendingChallenge(
  challengeId: string,
  record: Omit<PendingChallenge, "challengeId">
): Promise<void> {
  const db = getFirestore();
  await db
    .collection("pending_challenges")
    .doc(challengeId)
    .set({ challengeId, ...record });
}

export async function consumePendingChallenge(
  challengeId: string
): Promise<PendingChallenge | null> {
  const db = getFirestore();
  const ref = db.collection("pending_challenges").doc(challengeId);

  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const record = snap.data() as PendingChallenge;
    if (record.expiresAt < Date.now()) {
      tx.delete(ref);
      return null;
    }

    tx.delete(ref);
    return record;
  });
}

// ─── WebAuthn assertion verification ─────────────────────────────────────────

interface AssertionVerifyInput {
  assertion: WebAuthnAssertion;
  expectedChallenge: Uint8Array;
  expectedOrigin: string;
  publicKey: string;
}

export async function verifyWebAuthnAssertion(
  input: AssertionVerifyInput
): Promise<boolean> {
  // @proofline/webauthn drives the assertion ceremony via finishAssertion,
  // which pulls the challenge from clientDataJSON and looks it up in a
  // ChallengeStore. The sign-finalize handler already brokered the challenge
  // (the canonical-payload bytes are what the client signed) so we seed a
  // single-use in-memory store with that challenge before delegating.
  const expectedChallenge = Buffer.from(input.expectedChallenge).toString("base64url");

  const challengeStore = new InMemoryChallengeStore();
  const now = Date.now();
  await challengeStore.put({
    challenge: expectedChallenge,
    userId: "",        // unused by finishAssertion's verification path
    purpose: "assertion",
    rpId: "proofline-sign.web.app",
    createdAt: now,
    expiresAt: now + 60_000,
    consumed: false,
  });

  // Adapt flat WebAuthnAssertion → AuthenticationResponseJSON shape that
  // @simplewebauthn/server expects.
  const response = {
    id: input.assertion.credentialId,
    rawId: input.assertion.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: input.assertion.clientDataJSON,
      authenticatorData: input.assertion.authenticatorData,
      signature: input.assertion.signature,
      ...(input.assertion.userHandle ? { userHandle: input.assertion.userHandle } : {}),
    },
  };

  const result = await finishAssertion({
    // Cast: the local WebAuthnAssertion is a structural subset of
    // AuthenticationResponseJSON; finishAssertion only reads the fields above.
    response: response as Parameters<typeof finishAssertion>[0]["response"],
    expectedRPID: "proofline-sign.web.app",
    expectedOrigin: input.expectedOrigin,
    storedPublicKey: input.publicKey,
    storedSignCount: 0,
    challengeStore,
  });

  return result.ok;
}

// ─── Envelope persistence ─────────────────────────────────────────────────────

export async function recordSignedEnvelope(
  envelope: EmailSignedEnvelope
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection("signed_messages").doc(envelope.envelopeId);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      throw new Error(
        `Envelope ${envelope.envelopeId} already exists — duplicate finalize?`
      );
    }
    tx.set(ref, { ...envelope });
  });
}

// ─── Session management ───────────────────────────────────────────────────────

interface CreateSessionInput {
  userId: string;
  companyId: string;
  recipientSetHash: string;
  recipientAddresses: string[];
  deviceCredentialId: string;
  now: number;
  policy: CompanyPolicy;
}

export async function createSession(
  input: CreateSessionInput
): Promise<SigningSession> {
  const sessionId = uuidv7();
  const session: SigningSession = {
    sessionId,
    userId: input.userId,
    companyId: input.companyId,
    recipientSetHash: input.recipientSetHash,
    recipientAddresses: input.recipientAddresses,
    authorizedAt: input.now,
    expiresAt: input.now + input.policy.sessionTtlMs,
    hardCapAt: input.now + input.policy.sessionHardCapMs,
    deviceCredentialId: input.deviceCredentialId,
    status: "active",
    lastUsedAt: input.now,
    signCount: 1,
  };

  const db = getFirestore();
  await db.collection("sessions").doc(sessionId).set(session);

  return session;
}

export async function extendSession(
  sessionId: string,
  ctx: PolicyContext
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection("sessions").doc(sessionId);

  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const session = snap.data() as SigningSession;

    const now = ctx.now();
    const policy = await ctx.getCompanyPolicy(session.companyId);
    const newExpiry = Math.min(
      now + policy.sessionTtlMs,
      session.hardCapAt
    );

    tx.update(ref, {
      expiresAt: newExpiry,
      lastUsedAt: now,
      signCount: session.signCount + 1,
    });
  });
}

// ─── Anchor batching ──────────────────────────────────────────────────────────

export async function queueAnchorBatch(
  envelopeId: string,
  payloadHash: string
): Promise<void> {
  const db = getFirestore();
  await db.collection("anchor_queue").add({
    envelopeId,
    payloadHash,
    queuedAt: Date.now(),
  });
}

// ─── Co-signer resolution ─────────────────────────────────────────────────────

export async function resolveEligibleCosigners(
  companyId: string,
  _ctx: PolicyContext
): Promise<string[]> {
  const db = getFirestore();
  const snap = await db
    .collection("users")
    .where("companyId", "==", companyId)
    .where("role", "in", ["owner", "manager"])
    .where("status", "==", "active")
    .get();
  return snap.docs.map((d: any) => d.id as string);
}

// ─── Signer display resolution ────────────────────────────────────────────────

export async function resolveSignerDisplayRecord(
  userId: string
): Promise<SignerDisplayRecord> {
  const db = getFirestore();
  const snap = await db.collection("users").doc(userId).get();
  if (!snap.exists) {
    return {
      userId,
      name: userId,
      role: "Unknown",
      companyName: "",
      domain: "",
      signedAt: Date.now(),
    };
  }
  const data = (snap.data() ?? {}) as {
    displayName?: string;
    role?: string;
    companyId?: string;
  };

  // PFL-109: companyName + domain live on the COMPANY doc, not the user
  // doc. Look up companies/{companyId} and read legalName + domain there.
  let companyName = "";
  let domain = "";
  if (data.companyId) {
    const companySnap = await db.collection("companies").doc(data.companyId).get();
    if (companySnap.exists) {
      const company = (companySnap.data() ?? {}) as { legalName?: string; domain?: string };
      companyName = company.legalName ?? "";
      domain = company.domain ?? "";
    }
  }

  return {
    userId,
    name: data.displayName ?? userId,   // PFL-108 sets displayName at auth time
    role: data.role ?? "Unknown",
    companyName,
    domain,
    signedAt: Date.now(),
  };
}