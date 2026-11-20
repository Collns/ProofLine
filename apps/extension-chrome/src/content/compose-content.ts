/**
 * @file compose-content.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-181: a synchronous "content fingerprint" of a compose, used to re-lock
 * Send when a signed draft is edited (or when Gmail recycles a compose
 * container for a brand-new message).
 *
 * A ProofLine signature binds to the canonical payload hash. If the user
 * edits the recipients, subject, body, or wire fields after signing, the
 * signature no longer matches what Gmail would send — so Send must re-lock.
 * The signed envelope's own hash is computed asynchronously in the popup
 * ceremony, but the send guard runs in a capture-phase listener and cannot
 * await. So we compare the *content-bearing* fields only, canonicalized the
 * same way the signed payload is (RFC 8785 / JCS), which is fully
 * synchronous. Volatile fields the signature also covers but the user never
 * edits — nonce, issuedAt, expiresAt — are deliberately excluded so a plain
 * re-read doesn't look like an edit.
 */

import { canonicalize } from '@proofline/canonical';

import { buildSignPayload } from './sign-payload.js';

/**
 * Canonical string of the content-bearing fields of the compose, or null if
 * the payload can't be extracted (e.g. recipients cleared). Two calls return
 * the same string iff the user-visible content is unchanged.
 */
export function contentFingerprint(compose: Element): string | null {
  try {
    const result = buildSignPayload(compose);
    if (!result.ok) return null;
    const p = result.payload;
    const stable = {
      to: p.to,
      cc: p.cc ?? [],
      bcc: p.bcc ?? [],
      subject: p.subject,
      body: p.body,
      isWireInstruction: p.isWireInstruction === true,
      wirePayload: p.wirePayload ?? null,
    };
    return new TextDecoder().decode(canonicalize(stable));
  } catch {
    return null;
  }
}
