/**
 * @file heuristic.ts
 * @module packages/ai/src/providers
 *
 * Deterministic keyword screener (PFL-028). No network, no key. Used where
 * no model provider is configured, and as a baseline to compare against.
 * It only recognises common English phrasings, so it misses a lot; treat
 * a clean result as "nothing obvious", not "safe".
 */

import type { MemoScreener, ScreeningFlag, ScreeningFlagType, ScreeningInput, ScreeningResult } from "../types.js";

const RULES: { type: ScreeningFlagType; weight: number; patterns: RegExp[] }[] = [
  {
    type: "urgency", weight: 20,
    patterns: [/\burgent(ly)?\b/i, /\bimmediately\b/i, /\basap\b/i, /\bright away\b/i, /\btoday\b.*\b(before|by)\b/i, /\btime[- ]sensitive\b/i],
  },
  {
    type: "secrecy", weight: 25,
    patterns: [/\bconfidential\b/i, /\bkeep (this|it) (between us|quiet|private)\b/i, /\bdo not (call|tell|discuss|share)\b/i, /\bdon'?t (call|tell|discuss|share)\b/i],
  },
  {
    type: "executive_impersonation", weight: 20,
    patterns: [/\b(ceo|cfo|president|managing partner)\b.*\b(asked|wants|needs|approved)\b/i, /\bon behalf of (the )?(ceo|cfo|president)\b/i],
  },
  {
    type: "procedure_bypass", weight: 25,
    patterns: [/\b(skip|bypass|without) (the )?(usual|normal|standard)? ?(approval|verification|process|call[- ]?back)\b/i, /\bno need to (verify|confirm|call)\b/i],
  },
  {
    type: "payment_change", weight: 30,
    patterns: [/\b(new|updated|changed|different) (bank|account|wiring|wire) (details|instructions|information|number)\b/i, /\bour (bank|account) (has )?changed\b/i, /\b(bank|account|wire|wiring) (details|information|instructions) (have|has) (changed|been updated)\b/i, /\bplease (use|send to) (this|the following|our new) account\b/i],
  },
  {
    type: "unusual_request", weight: 25,
    patterns: [/\bgift cards?\b/i, /\b(bitcoin|crypto|usdt|usdc)\b/i, /\boverseas account\b/i],
  },
];

function evidenceFor(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - 30);
  return text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, " ").trim();
}

export function makeHeuristicScreener(): MemoScreener {
  return {
    provider: "heuristic",
    async screen(input: ScreeningInput): Promise<ScreeningResult> {
      const text = [input.subject, input.memo ?? "", input.body].join("\n");
      const flags: ScreeningFlag[] = [];
      let score = 0;
      for (const rule of RULES) {
        const hit = rule.patterns.find((p) => p.test(text));
        if (hit) {
          flags.push({ type: rule.type, evidence: evidenceFor(text, hit) });
          score += rule.weight;
        }
      }
      return {
        score: Math.min(100, score),
        flags,
        provider: "heuristic",
        ...(flags.length > 0 ? { summary: `Matched ${flags.map((f) => f.type.replace(/_/g, " ")).join(", ")}.` } : {}),
      };
    },
  };
}

export function makeNoopScreener(): MemoScreener {
  return {
    provider: "none",
    async screen(): Promise<ScreeningResult> {
      return { score: 0, flags: [], provider: "none" };
    },
  };
}
