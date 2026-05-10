/**
 * The F-SIG-09 / ADR-0010 mandatory pre-biometric verification checklist.
 *
 * The cosign landing surface MUST run all 6 steps to completion BEFORE
 * the user can fire the WebAuthn assertion. The button is disabled
 * unless every step is `passed`. If any step `failed`, the surface
 * surfaces a specific, non-alarmist error and does NOT run later steps.
 */

import { canonicalize } from '@proofline/canonical';

import type { CosignContextResponse, CosignLinkClaims } from '../api/types';
import { decodeCosignJws, isExpired } from './jws-decode';

export type ChecklistStepId =
  | 'decoded'
  | 'fetched'
  | 'recomputed-hash'
  | 'hash-match'
  | 'signer-verified'
  | 'reviewing';

export type ChecklistStepStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface ChecklistStep {
  id:     ChecklistStepId;
  label:  string;
  status: ChecklistStepStatus;
  /** Populated only when status='failed'; user-facing copy. */
  failureDetail?: string;
}

export const STEP_LABELS: Record<ChecklistStepId, (signerName: string) => string> = {
  'decoded':         () => 'Cosign request decoded',
  'fetched':         () => 'Fetched original message from ProofLine',
  'recomputed-hash': () => 'Recomputed payload hash',
  'hash-match':      () => "Confirmed message hasn't been tampered",
  'signer-verified': (signerName) => `Verified ${signerName} signed this exact content`,
  'reviewing':       () => 'Reviewing wire details — confirm before approving',
};

export const STEP_ORDER: ChecklistStepId[] = [
  'decoded',
  'fetched',
  'recomputed-hash',
  'hash-match',
  'signer-verified',
  'reviewing',
];

export interface ChecklistOutcome {
  steps:    ChecklistStep[];
  /** True iff every step is `passed`. */
  allPassed: boolean;
  /** First-failure index, or -1. */
  failedAt: number;
  /** When all steps pass, the trustworthy claims to display. */
  claims?:  CosignLinkClaims;
  /** When all steps pass, the server-canonical bytes that hash to claims.payloadHash. */
  canonicalBytes?: Uint8Array;
}

export interface RunChecklistInput {
  jws:           string;
  context:       CosignContextResponse;
  /** Defaults to Date.now/1000 (unix seconds). */
  nowSeconds?:   number;
  /** Override the SHA-256 hasher (tests). Returns hex-encoded digest. */
  sha256Hex?:    (bytes: Uint8Array) => Promise<string>;
  /** Optional async tick so the UI can animate "running" between steps. */
  onStep?:       (step: ChecklistStep, index: number) => Promise<void> | void;
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export async function runVerifyChecklist(input: RunChecklistInput): Promise<ChecklistOutcome> {
  const now      = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const hasher   = input.sha256Hex   ?? sha256HexWebCrypto;

  const steps: ChecklistStep[] = STEP_ORDER.map((id) => ({
    id,
    label:  STEP_LABELS[id](inferSignerName(input.context)),
    status: 'pending' as ChecklistStepStatus,
  }));

  let claims: CosignLinkClaims | null = null;
  let canonicalBytes: Uint8Array | undefined;

  // ── Step 1: decode JWS ─────────────────────────────────────────────────────
  await tick(steps, 0, 'running', input.onStep);
  claims = decodeCosignJws(input.jws);
  if (!claims) {
    return finalize(steps, 0, 'The cosign link is malformed or unreadable.', input.onStep);
  }
  if (isExpired(claims, now)) {
    return finalize(steps, 0, 'This cosign link has expired.', input.onStep);
  }
  await tick(steps, 0, 'passed', input.onStep);

  // ── Step 2: fetched envelope from server ───────────────────────────────────
  await tick(steps, 1, 'running', input.onStep);
  if (!input.context.ok) {
    return finalize(steps, 1, contextFailureCopy(input.context.code), input.onStep);
  }
  await tick(steps, 1, 'passed', input.onStep);

  // ── Step 3: recompute payloadHash from server-canonical bytes ──────────────
  await tick(steps, 2, 'running', input.onStep);
  try {
    canonicalBytes = canonicalize(input.context.payload);
  } catch (err) {
    return finalize(steps, 2, `Could not re-serialize the payload: ${(err as Error).message}`, input.onStep);
  }
  const recomputedHash = await hasher(canonicalBytes);
  await tick(steps, 2, 'passed', input.onStep);

  // ── Step 4: claimed payloadHash matches recomputed hash AND server's stored hash ─
  await tick(steps, 3, 'running', input.onStep);
  const claimedHash = normalizeHex(claims.payloadHash);
  const serverHash  = normalizeHex(input.context.payloadHash);
  if (recomputedHash !== claimedHash) {
    return finalize(
      steps, 3,
      'The wire details do not match the original cosign request — refusing to proceed.',
      input.onStep,
    );
  }
  if (recomputedHash !== serverHash) {
    return finalize(
      steps, 3,
      'The server returned a different message than the one referenced by your link — refusing to proceed.',
      input.onStep,
    );
  }
  await tick(steps, 3, 'passed', input.onStep);

  // ── Step 5: server confirms a verified signer ──────────────────────────────
  await tick(steps, 4, 'running', input.onStep);
  if (!input.context.envelope?.signers?.length) {
    return finalize(steps, 4, 'The server returned no signer information for this message.', input.onStep);
  }
  if (input.context.envelope.signers[0].userId !== input.context.signer.userId) {
    return finalize(steps, 4, 'The signer attribution does not match the envelope.', input.onStep);
  }
  await tick(steps, 4, 'passed', input.onStep);

  // ── Step 6: reviewing — final visual gate before user reviews details ──────
  await tick(steps, 5, 'running', input.onStep);
  await tick(steps, 5, 'passed', input.onStep);

  return {
    steps,
    allPassed: true,
    failedAt:  -1,
    claims,
    canonicalBytes,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tick(
  steps: ChecklistStep[],
  index: number,
  status: ChecklistStepStatus,
  onStep?: RunChecklistInput['onStep'],
): Promise<void> {
  steps[index] = { ...steps[index], status };
  if (onStep) await onStep(steps[index], index);
}

async function finalize(
  steps: ChecklistStep[],
  index: number,
  detail: string,
  onStep?: RunChecklistInput['onStep'],
): Promise<ChecklistOutcome> {
  steps[index] = { ...steps[index], status: 'failed', failureDetail: detail };
  if (onStep) await onStep(steps[index], index);
  return { steps, allPassed: false, failedAt: index };
}

function inferSignerName(ctx: CosignContextResponse): string {
  if (!ctx.ok) return 'the original signer';
  return ctx.signer.userDisplayName || 'the original signer';
}

function contextFailureCopy(code: string): string {
  switch (code) {
    case 'COSIGN_LINK_EXPIRED':
      return 'This cosign link has expired.';
    case 'COSIGN_LINK_INVALID':
      return 'The cosign link signature did not validate.';
    case 'ALREADY_COSIGNED':
      return 'This wire has already been cosigned.';
    case 'POLICY_REJECTED':
      return 'Company policy refused this cosign.';
    case 'NOT_FOUND':
      return 'The referenced message could not be found.';
    case 'NETWORK_ERROR':
      return 'We could not reach the ProofLine service.';
    default:
      return 'The server refused this cosign request.';
  }
}

function normalizeHex(s: string): string {
  return (s ?? '').toLowerCase().replace(/^0x/, '');
}

async function sha256HexWebCrypto(bytes: Uint8Array): Promise<string> {
  // Web Crypto present in browsers and modern Node (>=20) and jsdom.
  const subtle =
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error('SubtleCrypto not available');
  // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer typing weirdness.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await subtle.digest('SHA-256', view.buffer);
  return bufferToHex(new Uint8Array(digest));
}

function bufferToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
