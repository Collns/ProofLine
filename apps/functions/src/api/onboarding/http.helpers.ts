/**
 * @file http.helpers.ts
 * @module apps/functions/src/api/onboarding
 *
 * RFC 7807 Problem Details shared by all onboarding handlers.
 * Mirrors signing/handlers/http.helpers.ts — keep in sync or extract to shared package.
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
  instance?: string
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
  badRequest:  (detail?: string) => makeRFC7807Error("about:blank",                                          "Bad Request",           400, detail),
  unauthorized:(detail?: string) => makeRFC7807Error("about:blank",                                          "Unauthorized",          401, detail),
  forbidden:   (detail?: string) => makeRFC7807Error("about:blank",                                          "Forbidden",             403, detail),
  notFound:    (detail?: string) => makeRFC7807Error("about:blank",                                          "Not Found",             404, detail),
  conflict:    (code: string, detail?: string) =>
    makeRFC7807Error(`https://proofline.app/errors/${code}`,           code,                    409, detail),
  unprocessable:(code: string, detail?: string) =>
    makeRFC7807Error(`https://proofline.app/errors/${code}`,           code,                    422, detail),
  internal:    (detail?: string) => makeRFC7807Error("about:blank",                                          "Internal Server Error", 500, detail),
} as const;