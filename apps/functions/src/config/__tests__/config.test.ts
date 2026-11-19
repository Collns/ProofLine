/**
 * PFL-169 — explicit provider selection, fail-closed config and secrets.
 */

import { describe, it, expect } from "vitest";

import { loadConfig, describeConfig, isDeployed, ConfigError } from "../config.js";
import { readSecret, assertSecrets, MIN_SECRET_LENGTH } from "../secrets.js";

const DEPLOYED = { K_SERVICE: "api" };
const RESEND = { RESEND_API_KEY: "re_test", RESEND_FROM_DOMAIN: "mail.proofline.test" };
const ANCHOR = {
  BASE_SEPOLIA_RPC: "https://sepolia.base.org",
  DEPLOYER_PRIVATE_KEY: "0x" + "11".repeat(32),
  ANCHOR_CONTRACT_ADDRESS: "0x" + "ab".repeat(20),
};
const KMS = { GOOGLE_CLOUD_PROJECT: "proofline-test", KMS_KEYRING: "roots", KMS_LOCATION: "us-east1" };
const PROD_OK = {
  ...DEPLOYED, PROOFLINE_ENV: "production",
  EMAIL_PROVIDER: "resend", ANCHOR_PROVIDER: "base-sepolia", KMS_PROVIDER: "gcp",
  ...RESEND, ...ANCHOR, ...KMS,
};

function problemsOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).problems;
  }
  return [];
}

describe("loadConfig — environment", () => {
  it("defaults to development with stubs off-platform", () => {
    const cfg = loadConfig({});
    expect(cfg.env).toBe("development");
    expect(cfg.providers).toEqual({ email: "stub", anchor: "stub", kms: "stub", kyb: "stub", idv: "stub" });
  });

  it("requires PROOFLINE_ENV when deployed (Cloud Functions doesn't set NODE_ENV)", () => {
    expect(isDeployed(DEPLOYED)).toBe(true);
    expect(isDeployed({ ...DEPLOYED, FUNCTIONS_EMULATOR: "true" })).toBe(false);
    expect(problemsOf({ ...DEPLOYED, NODE_ENV: "production" }))
      .toContain("PROOFLINE_ENV must be set when deployed (one of: production, staging, development)");
  });

  it("rejects an unknown PROOFLINE_ENV", () => {
    expect(problemsOf({ PROOFLINE_ENV: "prod" })[0]).toMatch(/PROOFLINE_ENV="prod" is not valid/);
  });
});

describe("loadConfig — provider rules", () => {
  it("accepts a complete production config", () => {
    const cfg = loadConfig(PROD_OK);
    expect(cfg.providers).toMatchObject({ email: "resend", anchor: "base-sepolia", kms: "gcp", kyb: "stub", idv: "stub" });
    expect(cfg.kms).toEqual({ projectId: "proofline-test", location: "us-east1", keyRing: "roots" });
  });

  it("requires email/anchor/KMS to be chosen explicitly outside development", () => {
    const problems = problemsOf({ PROOFLINE_ENV: "staging" });
    expect(problems).toEqual([
      "EMAIL_PROVIDER must be set explicitly (one of: resend, stub)",
      "ANCHOR_PROVIDER must be set explicitly (one of: base-sepolia, stub)",
      "KMS_PROVIDER must be set explicitly (one of: gcp, stub)",
    ]);
  });

  it("allows explicit stubs in staging", () => {
    const cfg = loadConfig({ PROOFLINE_ENV: "staging", EMAIL_PROVIDER: "stub", ANCHOR_PROVIDER: "stub", KMS_PROVIDER: "stub" });
    expect(cfg.providers.email).toBe("stub");
  });

  it("refuses stub email / anchor / KMS in production", () => {
    const problems = problemsOf({ ...PROD_OK, EMAIL_PROVIDER: "stub", ANCHOR_PROVIDER: "stub", KMS_PROVIDER: "stub" });
    expect(problems).toEqual([
      "EMAIL_PROVIDER=stub is not allowed in production",
      "ANCHOR_PROVIDER=stub is not allowed in production",
      "KMS_PROVIDER=stub is not allowed in production",
    ]);
  });

  it("reports every missing setting for a real provider, never falling back", () => {
    const problems = problemsOf({ EMAIL_PROVIDER: "resend", ANCHOR_PROVIDER: "base-sepolia", KMS_PROVIDER: "gcp" });
    expect(problems).toEqual([
      "EMAIL_PROVIDER=resend is selected but RESEND_API_KEY, RESEND_FROM_DOMAIN are not set",
      "ANCHOR_PROVIDER=base-sepolia is selected but BASE_SEPOLIA_RPC, DEPLOYER_PRIVATE_KEY, ANCHOR_CONTRACT_ADDRESS are not set",
      "KMS_PROVIDER=gcp is selected but no project is set (KMS_PROJECT or GOOGLE_CLOUD_PROJECT)",
      "KMS_PROVIDER=gcp is selected but KMS_KEYRING is not set",
    ]);
  });

  it("validates values and the contract address format", () => {
    expect(problemsOf({ EMAIL_PROVIDER: "sendgrid" })[0]).toMatch(/EMAIL_PROVIDER="sendgrid" is not valid/);
    expect(problemsOf({ ANCHOR_PROVIDER: "base-sepolia", ...ANCHOR, ANCHOR_CONTRACT_ADDRESS: "0x123" }))
      .toEqual(["ANCHOR_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address"]);
  });

  it("keeps KYB / IDV on stub until PFL-162 wires the adapters", () => {
    expect(problemsOf({ KYB_PROVIDER: "baselayer", IDV_PROVIDER: "stripe" })).toEqual([
      "KYB_PROVIDER=baselayer is not wired into the functions app yet (PFL-162); use stub",
      "IDV_PROVIDER=stripe is not wired into the functions app yet (PFL-162); use stub",
    ]);
  });

  it("describeConfig never includes keys or secrets", () => {
    const text = JSON.stringify(describeConfig(loadConfig(PROD_OK)));
    expect(text).not.toContain("re_test");
    expect(text).not.toContain(ANCHOR.DEPLOYER_PRIVATE_KEY);
    expect(text).toContain('"stubs":["kyb","idv"]');
  });
});

describe("secrets", () => {
  const long = "x".repeat(MIN_SECRET_LENGTH);

  it("returns a valid secret", () => {
    expect(readSecret("BILATERAL_JWT_SECRET", { BILATERAL_JWT_SECRET: ` ${long} ` })).toBe(long);
  });

  it("throws when missing or too short — there is no fallback", () => {
    expect(() => readSecret("BILATERAL_JWT_SECRET", {})).toThrow(/BILATERAL_JWT_SECRET is not set/);
    expect(() => readSecret("COSIGN_REFRESH_SECRET", { COSIGN_REFRESH_SECRET: "short" }))
      .toThrow(/at least 32 characters/);
  });

  it("assertSecrets lists every problem", () => {
    try {
      assertSecrets(["PROOFLINE_AUTH_JWT_SECRET", "BILATERAL_JWT_SECRET"], { PROOFLINE_AUTH_JWT_SECRET: "abc" });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).problems).toEqual([
        "PROOFLINE_AUTH_JWT_SECRET must be at least 32 characters",
        "BILATERAL_JWT_SECRET is not set",
      ]);
    }
  });
});
