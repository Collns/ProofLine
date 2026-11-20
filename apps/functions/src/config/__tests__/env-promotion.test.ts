/**
 * PFL-188 — the esbuild `.env` promotion list must cover every NON-SECRET env
 * key config.ts reads, or a deployed function silently loses that key and
 * 503s with CONFIG_INVALID (this happened with PROOFLINE_ENV / *_PROVIDER).
 *
 * Derives the required keys from config.ts source and checks them against the
 * RUNTIME_ENV_KEYS allowlist in esbuild.config.mjs, so the two can't drift.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const configSrc = readFileSync(fileURLToPath(new URL("../config.ts", import.meta.url)), "utf8");
const esbuildSrc = readFileSync(fileURLToPath(new URL("../../../esbuild.config.mjs", import.meta.url)), "utf8");

// Keys delivered via Secret Manager (defineSecret), never via .env — excluded.
const SECRET_KEYS = new Set([
  "PROOFLINE_AUTH_JWT_SECRET", "BILATERAL_JWT_SECRET", "COSIGN_REFRESH_SECRET",
  "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_IDENTITY_WEBHOOK_SECRET",
  "BASELAYER_API_KEY", "BASELAYER_WEBHOOK_SECRET", "COBALT_API_KEY", "GEMINI_API_KEY",
]);

function envKeysReadByConfig(): Set<string> {
  const keys = new Set<string>();
  for (const m of configSrc.matchAll(/\bval\(env,\s*"([A-Z0-9_]+)"\)/g)) keys.add(m[1]!);
  for (const m of configSrc.matchAll(/\bpick\(env,\s*"([A-Z0-9_]+)"/g)) keys.add(m[1]!);
  // requireKeys(label, ["A", "B", ...], problems)
  for (const block of configSrc.matchAll(/requireKeys\([^,]+,\s*\[([^\]]*)\]/g)) {
    for (const k of block[1]!.matchAll(/"([A-Z0-9_]+)"/g)) keys.add(k[1]!);
  }
  return keys;
}

function promotionAllowlist(): Set<string> {
  const block = esbuildSrc.match(/const RUNTIME_ENV_KEYS = \[([\s\S]*?)\];/);
  if (!block) throw new Error("RUNTIME_ENV_KEYS not found in esbuild.config.mjs");
  const keys = new Set<string>();
  for (const k of block[1]!.matchAll(/"([A-Z0-9_]+)"/g)) keys.add(k[1]!);
  return keys;
}

describe("esbuild env promotion vs config.ts", () => {
  it("promotes every non-secret env key config.ts reads", () => {
    const required = [...envKeysReadByConfig()].filter((k) => !SECRET_KEYS.has(k));
    const allowlist = promotionAllowlist();
    const missing = required.filter((k) => !allowlist.has(k));
    expect(missing, `add these to RUNTIME_ENV_KEYS in esbuild.config.mjs: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes the keys production requires (regression for the CONFIG_INVALID deploy)", () => {
    const allowlist = promotionAllowlist();
    for (const k of ["PROOFLINE_ENV", "EMAIL_PROVIDER", "ANCHOR_PROVIDER", "KMS_PROVIDER"]) {
      expect(allowlist.has(k), `${k} must be promotable`).toBe(true);
    }
  });
});
