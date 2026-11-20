/**
 * @file policy.helpers.ts
 * @module apps/functions/src/api/policy
 *
 * PFL-188 — read/normalize a company's unsigned-email policy from its
 * Firestore doc. Absent or malformed → the LOCKED default (block + override),
 * so every company (including existing ones that never set the field) starts
 * at block.
 */

import {
  DEFAULT_UNSIGNED_EMAIL_POLICY,
  type UnsignedEmailPolicy,
  type UnsignedEmailPolicyMode,
} from "@proofline/types";

const MODES: readonly UnsignedEmailPolicyMode[] = ["block", "warn", "allow"];

export function readUnsignedPolicy(companyData: Record<string, unknown> | null | undefined): UnsignedEmailPolicy {
  const raw = (companyData?.["unsignedEmailPolicy"] ?? null) as
    | { mode?: unknown; allowUnsignedOverride?: unknown }
    | null;
  const mode = MODES.includes(raw?.mode as UnsignedEmailPolicyMode)
    ? (raw!.mode as UnsignedEmailPolicyMode)
    : DEFAULT_UNSIGNED_EMAIL_POLICY.mode;
  const allowUnsignedOverride =
    typeof raw?.allowUnsignedOverride === "boolean"
      ? raw.allowUnsignedOverride
      : DEFAULT_UNSIGNED_EMAIL_POLICY.allowUnsignedOverride;
  return { mode, allowUnsignedOverride };
}
