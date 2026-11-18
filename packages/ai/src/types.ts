/**
 * @file types.ts
 * @module packages/ai
 *
 * Memo screening for business-email-compromise (BEC) patterns (PFL-028).
 * Screening is advisory: results are attached to the signing decision as
 * warnings and never block signing on their own.
 */

export const SCREENING_FLAG_TYPES = [
  "urgency",                 // pressure to act immediately
  "secrecy",                 // "keep this between us", don't call to confirm
  "executive_impersonation", // claims to act for an executive / authority
  "procedure_bypass",        // skip normal approval / verification steps
  "payment_change",          // new or changed bank / account details
  "unusual_request",         // gift cards, crypto, unusual destination
] as const;

export type ScreeningFlagType = (typeof SCREENING_FLAG_TYPES)[number];

export interface ScreeningFlag {
  type:     ScreeningFlagType;
  /** Short quote or paraphrase from the message that triggered the flag. */
  evidence: string;
}

export interface ScreeningInput {
  subject:      string;
  body:         string;
  memo?:        string;
  amountUsd?:   number;
  senderDomain?: string;
  recipientDomains?: string[];
}

export interface ScreeningResult {
  /** 0 (no concern) … 100 (very likely social engineering). */
  score:     number;
  flags:     ScreeningFlag[];
  /** Which screener produced this ("gemini", "heuristic", "none"). */
  provider:  string;
  model?:    string;
  /** One-sentence explanation suitable for a signer-facing warning. */
  summary?:  string;
}

export interface MemoScreener {
  readonly provider: string;
  screen(input: ScreeningInput): Promise<ScreeningResult>;
}
