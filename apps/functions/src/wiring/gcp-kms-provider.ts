/**
 * @file gcp-kms-provider.ts
 * @module apps/functions/src/wiring
 *
 * Real Cloud KMS adapter for the onboarding `KmsProvider` interface
 * declared in api/onboarding/finalize.handler.ts (PFL-126).
 *
 * The lower-level provider in @proofline/crypto/providers/gcp-kms.ts
 * already knows how to talk to Google Cloud KMS — create an
 * EC_SIGN_P256_SHA256 key, wait for the version to reach ENABLED,
 * fetch the SPKI public key, asymmetric-sign a message. This module
 * is a thin shape adapter so the finalize handler — which works in
 * strings (keyName + base64url SPKI + base64url sig) — can stay
 * KMS-agnostic.
 *
 * Configuration comes from env:
 *   GOOGLE_CLOUD_PROJECT   — derived from the firebase function runtime
 *                            when deployed; can be overridden locally.
 *   KMS_LOCATION           — e.g. "global", "us-east1". Defaults to "global".
 *   KMS_KEYRING            — e.g. "proofline-roots". Defaults to
 *                            "proofline-roots" per TDD §7.5.
 *
 * If GOOGLE_CLOUD_PROJECT or KMS_KEYRING are absent we return null so
 * the caller falls back to the stub provider. Don't throw — local dev
 * and unit tests run without Cloud KMS and that path needs to stay
 * usable.
 */

import type { KmsProvider } from "../api/onboarding/finalize.handler.js";
import { makeKmsCryptoProvider, type GcpKmsConfig } from "@proofline/crypto/providers/gcp-kms";

export interface RealKmsEnvConfig {
  projectId?: string;
  location?:  string;
  keyRing?:   string;
}

/**
 * Resolve KMS config from the environment. Returns null when the
 * required values aren't present — callers should then fall back to
 * the stub provider.
 */
export function resolveKmsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GcpKmsConfig | null {
  const projectId =
    env["KMS_PROJECT"]            ??
    env["GOOGLE_CLOUD_PROJECT"]   ??
    env["GCLOUD_PROJECT"]         ??
    env["GCP_PROJECT"];
  if (!projectId) return null;

  // KEYRING is the discriminator: without it we don't know where to put
  // the company keys. Operators must set it explicitly to opt in to
  // real KMS — there's no safe default.
  const keyRing = env["KMS_KEYRING"];
  if (!keyRing) return null;

  const location = env["KMS_LOCATION"] ?? "global";

  return { projectId, location, keyRing };
}

/**
 * Wrap the @proofline/crypto KMS provider so it matches the local
 * `KmsProvider` interface used by finalize.handler.ts. The underlying
 * provider works in `KeyHandle`s; this adapter flattens to plain
 * resource-name strings.
 */
export function makeRealKmsProvider(config: GcpKmsConfig): KmsProvider {
  const underlying = makeKmsCryptoProvider(config);

  return {
    async createCompanyRootKey(companyId: string): Promise<{ keyName: string }> {
      const handle = await underlying.createCompanyRootKey(companyId);
      if (handle.kind !== "kms") {
        throw new Error(`UNEXPECTED_KEY_KIND: ${handle.kind}`);
      }
      return { keyName: handle.resourceName };
    },

    async signWithKms(keyName: string, messageBytes: Uint8Array): Promise<string> {
      return underlying.sign({ kind: "kms", resourceName: keyName }, messageBytes);
    },

    async exportPublicKey(keyName: string): Promise<string> {
      return underlying.exportPublicKey({ kind: "kms", resourceName: keyName });
    },
  };
}
