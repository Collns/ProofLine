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

export async function verifySessionTokenJWS(
  token: string
): Promise<SessionTokenPayload> {
  // TODO(follow-up): @proofline/sessions does not currently export
  // verifySessionToken — it exposes makeJoseVerifier({keys}).verify(token).
  // The dynamic require below has always returned undefined here, so any
  // silent-path finalize that reached this line throws. Tracked as a
  // separate landmine — out of scope for the payload-storage fix.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { verifySessionToken } = require("@proofline/sessions");
  return verifySessionToken(token);
}

export async function issueSessionToken(session: SigningSession): Promise<string> {
  // TODO(follow-up): see verifySessionTokenJWS — signSessionToken is not
  // exported by @proofline/sessions today. Fresh-path finalize hits this
  // after the payload-storage fix; needs a separate wiring PR.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { signSessionToken } = require("@proofline/sessions");
  return signSessionToken(session);
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
  // TODO(follow-up): @proofline/webauthn does not export verifyAssertion —
  // the server-side ceremony helpers are finishAssertion / finishRegistration.
  // This require has historically returned undefined; the call only succeeds
  // when stubbed. Tracked as a separate landmine.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { verifyAssertion } = require("@proofline/webauthn");
  return verifyAssertion({
    assertion: input.assertion,
    expectedChallenge: Buffer.from(input.expectedChallenge).toString("base64url"),
    expectedOrigin: input.expectedOrigin,
    publicKey: input.publicKey,
  });
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
    companyName?: string;
    domain?: string;
  };
  return {
    userId,
    name: data.displayName ?? userId,
    role: data.role ?? "Unknown",
    companyName: data.companyName ?? "",
    domain: data.domain ?? "",
    signedAt: Date.now(),
  };
}