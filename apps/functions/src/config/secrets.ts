/**
 * @file secrets.ts
 * @module apps/functions/src/config
 *
 * PFL-169 — HMAC secrets have no hardcoded fallback. Each one must be bound
 * to the function (Functions secrets, see index.ts) and be at least
 * MIN_SECRET_LENGTH characters. A missing or short secret throws, so a
 * request that needs it fails instead of signing with a guessable key.
 */

import { ConfigError } from "./config.js";

export const MIN_SECRET_LENGTH = 32;

export type SecretName =
  | "PROOFLINE_AUTH_JWT_SECRET"
  | "BILATERAL_JWT_SECRET"
  | "COSIGN_REFRESH_SECRET";

/** Secrets the `api` function needs; bound via defineSecret in index.ts. */
export const API_SECRETS: readonly SecretName[] = [
  "PROOFLINE_AUTH_JWT_SECRET",
  "BILATERAL_JWT_SECRET",
  "COSIGN_REFRESH_SECRET",
];

function problemFor(name: string, value: string | undefined): string | null {
  if (!value) return `${name} is not set`;
  if (value.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/** Returns the trimmed secret or throws ConfigError. Read per use, never cached at import. */
export function readSecret(name: SecretName, env: Record<string, string | undefined> = process.env): string {
  const value = env[name]?.trim();
  const problem = problemFor(name, value);
  if (problem) throw new ConfigError([problem]);
  return value!;
}

/** Validates a set of secrets at once (used at cold start). */
export function assertSecrets(
  names: readonly SecretName[],
  env: Record<string, string | undefined> = process.env,
): void {
  const problems = names
    .map((n) => problemFor(n, env[n]?.trim()))
    .filter((p): p is string => p !== null);
  if (problems.length > 0) throw new ConfigError(problems);
}
