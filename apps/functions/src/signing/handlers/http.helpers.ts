/**
 * @file http.helpers.ts
 * @module apps/functions/src/signing
 * RFC 7807 Problem Details (PRD §12.2 error model).
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
  return { type, title, status, ...(detail ? { detail } : {}), ...(instance ? { instance } : {}) };
}