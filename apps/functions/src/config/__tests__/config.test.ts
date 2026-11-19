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
    expect(cfg.providers).toEqual({ email: "stub", anchor: "stub", kms: "stub", kyb: "stub", idv: "stub", ai: "heuristic" });
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

  it("accepts KYB_PROVIDER=baselayer|cobalt only with their keys (PFL-162)", () => {
    expect(problemsOf({ KYB_PROVIDER: "baselayer" })).toEqual([
      "KYB_PROVIDER=baselayer is selected but BASELAYER_API_KEY, BASELAYER_WEBHOOK_SECRET are not set",
    ]);
    expect(problemsOf({ KYB_PROVIDER: "cobalt" })).toEqual([
      "KYB_PROVIDER=cobalt is selected but COBALT_API_KEY is not set",
    ]);
    const bl = loadConfig({ KYB_PROVIDER: "baselayer", BASELAYER_API_KEY: "bl_key_1", BASELAYER_WEBHOOK_SECRET: "whsec_bl" });
    expect(bl.providers.kyb).toBe("baselayer");
    expect(bl.kyb).toEqual({ baselayerApiKey: "bl_key_1", baselayerWebhookSecret: "whsec_bl" });
    expect(JSON.stringify(describeConfig(bl))).not.toContain("bl_key_1");
    expect(loadConfig({ KYB_PROVIDER: "cobalt", COBALT_API_KEY: "co_key" }).kyb).toEqual({ cobaltApiKey: "co_key" });
  });

  it("accepts IDV_PROVIDER=stripe only with both Stripe keys (PFL-176)", () => {
    expect(problemsOf({ IDV_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_1" })).toEqual([
      "IDV_PROVIDER=stripe is selected but STRIPE_IDENTITY_WEBHOOK_SECRET is not set",
    ]);
    const cfg = loadConfig({ IDV_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_1", STRIPE_IDENTITY_WEBHOOK_SECRET: "whsec_1" });
    expect(cfg.providers.idv).toBe("stripe");
    expect(cfg.idv).toEqual({ stripeSecretKey: "sk_test_1", stripeWebhookSecret: "whsec_1" });
    expect(JSON.stringify(describeConfig(cfg))).not.toContain("sk_test_1");
  });

  it("selects memo screening; gemini needs GEMINI_API_KEY (PFL-028)", () => {
    expect(loadConfig({}).providers.ai).toBe("heuristic");
    expect(problemsOf({ AI_PROVIDER: "gemini" })).toEqual([
      "AI_PROVIDER=gemini is selected but GEMINI_API_KEY is not set",
    ]);
    expect(problemsOf({ AI_PROVIDER: "openai" })[0]).toMatch(/AI_PROVIDER="openai" is not valid/);
    const cfg = loadConfig({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "g_key_1", GEMINI_MODEL: "gemini-3.5-flash" });
    expect(cfg.ai).toEqual({ geminiApiKey: "g_key_1", model: "gemini-3.5-flash" });
    expect(JSON.stringify(describeConfig(cfg))).not.toContain("g_key_1");
    expect(loadConfig({ AI_PROVIDER: "none" }).providers.ai).toBe("none");
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
