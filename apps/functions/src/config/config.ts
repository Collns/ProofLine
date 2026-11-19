/**
 * @file config.ts
 * @module apps/functions/src/config
 *
 * PFL-169 — explicit, fail-closed runtime configuration.
 *
 *   PROOFLINE_ENV   production | staging | development
 *                   Required when running deployed (Cloud Functions sets
 *                   K_SERVICE; it does NOT set NODE_ENV). Defaults to
 *                   development only off-platform (tests, emulator).
 *
 *   EMAIL_PROVIDER  resend | stub          (stub refused in production)
 *   ANCHOR_PROVIDER base-sepolia | stub    (stub refused in production)
 *   KMS_PROVIDER    gcp | stub             (stub refused in production)
 *   KYB_PROVIDER    stub | baselayer | cobalt   (default stub)
 *   IDV_PROVIDER    stub | stripe               (default stub)
 *   AI_PROVIDER     heuristic | gemini | none   (default heuristic; wire memo
 *                   screening, advisory only — PFL-028)
 *
 * Rules:
 *   - In staging/production, EMAIL/ANCHOR/KMS must be set explicitly.
 *     In development they default to stub.
 *   - A real provider with missing settings is an error, never a silent
 *     fallback to a stub.
 *   - Every problem is collected and reported together in one ConfigError.
 *   - KYB/IDV may run on stub in any environment (no vendor keys yet);
 *     stub-verified companies are routed to manual review (PFL-162/177).
 *   - IDV_PROVIDER=stripe needs STRIPE_SECRET_KEY + STRIPE_IDENTITY_WEBHOOK_SECRET
 *     (PFL-176).
 *   - KYB_PROVIDER=baselayer needs BASELAYER_API_KEY + BASELAYER_WEBHOOK_SECRET
 *     (the webhook delivers late IRS results); KYB_PROVIDER=cobalt needs
 *     COBALT_API_KEY (PFL-162).
 *   - AI_PROVIDER=gemini needs GEMINI_API_KEY; GEMINI_MODEL is optional.
 */

export type ProoflineEnv = "production" | "staging" | "development";

export type EmailProviderName  = "resend" | "stub";
export type AnchorProviderName = "base-sepolia" | "stub";
export type KmsProviderName    = "gcp" | "stub";
export type KybProviderName    = "stub" | "baselayer" | "cobalt";
export type IdvProviderName    = "stub" | "stripe";
export type AiProviderName     = "heuristic" | "gemini" | "none";

export interface ProviderSelection {
  email:  EmailProviderName;
  anchor: AnchorProviderName;
  kms:    KmsProviderName;
  kyb:    KybProviderName;
  idv:    IdvProviderName;
  ai:     AiProviderName;
}

export interface AppConfig {
  env:       ProoflineEnv;
  providers: ProviderSelection;
  email?:  { apiKey: string; fromDomain: string };
  anchor?: { rpcUrl: string; deployerKey: string; contractAddress: string };
  kms?:    { projectId: string; location: string; keyRing: string };
  idv?:    { stripeSecretKey: string; stripeWebhookSecret: string };
  kyb?:    { baselayerApiKey?: string; baselayerWebhookSecret?: string; cobaltApiKey?: string };
  ai?:     { geminiApiKey: string; model?: string };
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

const ENVS: readonly ProoflineEnv[] = ["production", "staging", "development"];

/** True when running on Cloud Functions / Cloud Run (not the emulator). */
export function isDeployed(env: Env): boolean {
  return Boolean(env["K_SERVICE"]) && !env["FUNCTIONS_EMULATOR"];
}

function val(env: Env, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

function pick<T extends string>(
  env: Env,
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
  problems: string[],
): T {
  const raw = val(env, key);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    problems.push(`${key} must be set explicitly (one of: ${allowed.join(", ")})`);
    // Placeholder so the remaining checks don't add noise; config is
    // rejected anyway because a problem was recorded.
    return ((allowed as readonly string[]).includes("stub") ? "stub" : allowed[0]!) as T;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    problems.push(`${key}="${raw}" is not valid (one of: ${allowed.join(", ")})`);
    return allowed[0]!;
  }
  return raw as T;
}

function requireKeys(env: Env, provider: string, keys: string[], problems: string[]): void {
  const missing = keys.filter((k) => !val(env, k));
  if (missing.length > 0) {
    problems.push(`${provider} is selected but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
  }
}

export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  // ── Environment ──────────────────────────────────────────────────────────
  let appEnv: ProoflineEnv = "development";
  const rawEnv = val(env, "PROOFLINE_ENV");
  if (rawEnv === undefined) {
    if (isDeployed(env)) {
      problems.push(`PROOFLINE_ENV must be set when deployed (one of: ${ENVS.join(", ")})`);
      appEnv = "production"; // evaluate the remaining rules strictly
    }
  } else if ((ENVS as readonly string[]).includes(rawEnv)) {
    appEnv = rawEnv as ProoflineEnv;
  } else {
    problems.push(`PROOFLINE_ENV="${rawEnv}" is not valid (one of: ${ENVS.join(", ")})`);
    appEnv = "production";
  }
  const dev = appEnv === "development";

  // ── Provider selection ───────────────────────────────────────────────────
  const providers: ProviderSelection = {
    email:  pick(env, "EMAIL_PROVIDER",  ["resend", "stub"] as const,        dev ? "stub" : undefined, problems),
    anchor: pick(env, "ANCHOR_PROVIDER", ["base-sepolia", "stub"] as const,  dev ? "stub" : undefined, problems),
    kms:    pick(env, "KMS_PROVIDER",    ["gcp", "stub"] as const,           dev ? "stub" : undefined, problems),
    kyb:    pick(env, "KYB_PROVIDER",    ["stub", "baselayer", "cobalt"] as const, "stub", problems),
    idv:    pick(env, "IDV_PROVIDER",    ["stub", "stripe"] as const,        "stub", problems),
    ai:     pick(env, "AI_PROVIDER",     ["heuristic", "gemini", "none"] as const, "heuristic", problems),
  };

  if (appEnv === "production") {
    for (const [key, name] of [
      ["EMAIL_PROVIDER", providers.email],
      ["ANCHOR_PROVIDER", providers.anchor],
      ["KMS_PROVIDER", providers.kms],
    ] as const) {
      if (name === "stub" && val(env, key) !== undefined) {
        problems.push(`${key}=stub is not allowed in production`);
      }
    }
  }

  // ── Provider settings ────────────────────────────────────────────────────
  const config: AppConfig = { env: appEnv, providers };

  if (providers.email === "resend") {
    requireKeys(env, "EMAIL_PROVIDER=resend", ["RESEND_API_KEY", "RESEND_FROM_DOMAIN"], problems);
    config.email = { apiKey: val(env, "RESEND_API_KEY") ?? "", fromDomain: val(env, "RESEND_FROM_DOMAIN") ?? "" };
  }

  if (providers.anchor === "base-sepolia") {
    requireKeys(env, "ANCHOR_PROVIDER=base-sepolia",
      ["BASE_SEPOLIA_RPC", "DEPLOYER_PRIVATE_KEY", "ANCHOR_CONTRACT_ADDRESS"], problems);
    const contract = val(env, "ANCHOR_CONTRACT_ADDRESS");
    if (contract && !/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      problems.push("ANCHOR_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address");
    }
    config.anchor = {
      rpcUrl:          val(env, "BASE_SEPOLIA_RPC") ?? "",
      deployerKey:     val(env, "DEPLOYER_PRIVATE_KEY") ?? "",
      contractAddress: contract ?? "",
    };
  }

  if (providers.kms === "gcp") {
    const projectId =
      val(env, "KMS_PROJECT") ?? val(env, "GOOGLE_CLOUD_PROJECT") ??
      val(env, "GCLOUD_PROJECT") ?? val(env, "GCP_PROJECT");
    if (!projectId) {
      problems.push("KMS_PROVIDER=gcp is selected but no project is set (KMS_PROJECT or GOOGLE_CLOUD_PROJECT)");
    }
    requireKeys(env, "KMS_PROVIDER=gcp", ["KMS_KEYRING"], problems);
    config.kms = {
      projectId: projectId ?? "",
      location:  val(env, "KMS_LOCATION") ?? "global",
      keyRing:   val(env, "KMS_KEYRING") ?? "",
    };
  }

  if (providers.idv === "stripe") {
    requireKeys(env, "IDV_PROVIDER=stripe", ["STRIPE_SECRET_KEY", "STRIPE_IDENTITY_WEBHOOK_SECRET"], problems);
    config.idv = {
      stripeSecretKey:     val(env, "STRIPE_SECRET_KEY") ?? "",
      stripeWebhookSecret: val(env, "STRIPE_IDENTITY_WEBHOOK_SECRET") ?? "",
    };
  }

  if (providers.kyb === "baselayer") {
    requireKeys(env, "KYB_PROVIDER=baselayer", ["BASELAYER_API_KEY", "BASELAYER_WEBHOOK_SECRET"], problems);
    config.kyb = {
      baselayerApiKey:        val(env, "BASELAYER_API_KEY") ?? "",
      baselayerWebhookSecret: val(env, "BASELAYER_WEBHOOK_SECRET") ?? "",
    };
  }

  if (providers.kyb === "cobalt") {
    requireKeys(env, "KYB_PROVIDER=cobalt", ["COBALT_API_KEY"], problems);
    config.kyb = { cobaltApiKey: val(env, "COBALT_API_KEY") ?? "" };
  }

  if (providers.ai === "gemini") {
    requireKeys(env, "AI_PROVIDER=gemini", ["GEMINI_API_KEY"], problems);
    const model = val(env, "GEMINI_MODEL");
    config.ai = { geminiApiKey: val(env, "GEMINI_API_KEY") ?? "", ...(model ? { model } : {}) };
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

/** Log-safe summary (no secrets). */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    env:       config.env,
    providers: config.providers,
    stubs:     Object.entries(config.providers).filter(([, v]) => v === "stub").map(([k]) => k),
    ...(config.kms ? { kms: { projectId: config.kms.projectId, location: config.kms.location, keyRing: config.kms.keyRing } } : {}),
    ...(config.email ? { email: { fromDomain: config.email.fromDomain } } : {}),
    ...(config.anchor ? { anchor: { contractAddress: config.anchor.contractAddress } } : {}),
    ...(config.ai?.model ? { ai: { model: config.ai.model } } : {}),
  };
}
