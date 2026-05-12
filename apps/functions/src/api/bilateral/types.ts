/**
 * @file types.ts
 * @module apps/functions/src/api/bilateral
 */

import type { BilateralService } from "@proofline/bilateral";
import type { EmailProvider, BilateralSummary } from "@proofline/email";

export type { BilateralSummary };

export interface BilateralRouterDeps {
  bilateralService:          BilateralService;
  email:                     EmailProvider;
  counterpartyPortalBaseUrl: string;
  now?: () => number;
}

export interface ProblemDetail {
  type:      string;
  title:     string;
  status:    number;
  detail:    string;
  instance?: string;
}

export function problem(status: number, title: string, detail: string): ProblemDetail {
  return { type: "about:blank", title, status, detail };
}

export const ERR = {
  badRequest:   (detail: string) => problem(400, "Bad Request",           detail),
  unauthorized: (detail: string) => problem(401, "Unauthorized",          detail),
  forbidden:    (detail: string) => problem(403, "Forbidden",             detail),
  notFound:     (detail: string) => problem(404, "Not Found",             detail),
  conflict:     (code: string, detail: string) => ({ ...problem(409, "Conflict", detail), code }),
  internal:     (detail: string) => problem(500, "Internal Server Error", detail),
};