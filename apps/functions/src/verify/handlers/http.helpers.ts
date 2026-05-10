/**
 * @file http.helpers.ts
 * @module apps/functions/src/verify
 *
 * RFC 7807 Problem Details for the verify endpoint. Mirrors
 * api/onboarding/http.helpers.ts and signing/handlers/http.helpers.ts —
 * kept local for now so the verify slice is self-contained. A future
 * refactor could lift these into a shared package.
 */

export interface RFC7807Error {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export function makeRFC7807Error(
  type: string,
  title: string,
  status: number,
  detail?: string,
  instance?: string,
): RFC7807Error {
  return {
    type,
    title,
    status,
    ...(detail ? { detail } : {}),
    ...(instance ? { instance } : {}),
  };
}

export const ERR = {
  badRequest: (code: string, detail?: string): RFC7807Error =>
    makeRFC7807Error(
      `https://proofline.app/errors/${code}`,
      code,
      400,
      detail,
    ),
  internal: (detail?: string): RFC7807Error =>
    makeRFC7807Error("about:blank", "Internal Server Error", 500, detail),
} as const;

// id format: UUIDv7-shaped or messageId-shaped (alphanumeric + dashes,
// reasonable length bounds). Anything else gets a 400. Lower bound is
// loose intentionally — short demo ids like "msg-001" should pass.
const ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

export function isValidVerifyId(raw: unknown): raw is string {
  return typeof raw === "string" && ID_RE.test(raw);
}
