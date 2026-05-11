/**
 * @file gcp-kms.ts
 * @module packages/crypto/src/providers
 *
 * Google Cloud KMS provider for ProofLine company root keys.
 *
 * Per ADR-0008 and TDD §7.5:
 *   - Each company gets its own EC_SIGN_P256_SHA256 asymmetric key
 *     in a shared KeyRing.
 *   - Private keys never leave the HSM. We sign by sending the
 *     raw message bytes to KMS which hashes internally with SHA-256
 *     and returns a DER ECDSA signature.
 *   - Verification is pure JS (no KMS round-trip) using the SPKI
 *     public key exported once at key creation and stored in
 *     companies/{companyId}.rootPublicKey.
 *
 * Key resource path format:
 *   projects/{projectId}/locations/{location}/keyRings/{keyRing}
 *     /cryptoKeys/company-{companyId}/cryptoKeyVersions/1
 *
 * NOTE: This provider sits behind the CryptoProvider interface defined
 * in ../types.ts. No other package imports @google-cloud/kms directly.
 */

import * as nodeCrypto from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import type { CryptoProvider, KeyHandle, Signature } from "../types.js";
import { verifyEcdsaP256 } from "../verify.js";
import { sha256 } from "../hash.js";
import { randomBytes } from "../random.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GcpKmsConfig {
  projectId: string;
  location:  string;          // e.g. "global", "us-east1"
  keyRing:   string;          // e.g. "proofline-roots"
  /**
   * Optional client override — for tests, pass a stub
   * KeyManagementServiceClient.  Production code omits this.
   */
  client?: KeyManagementServiceClient;
}

// ─── Internal: extract version-1 resource name from a base key path ──────────

function versionOneResourceName(keyResourceName: string): string {
  return `${keyResourceName}/cryptoKeyVersions/1`;
}

// ─── Public — provider factory ────────────────────────────────────────────────

export function makeKmsCryptoProvider(config: GcpKmsConfig): CryptoProvider & {
  createCompanyRootKey(companyId: string): Promise<KeyHandle>;
  exportPublicKey(handle: KeyHandle): Promise<string>;
} {
  const client = config.client ?? new KeyManagementServiceClient();

  return {
    async createCompanyRootKey(companyId: string): Promise<KeyHandle> {
      const parent = client.keyRingPath(
        config.projectId,
        config.location,
        config.keyRing,
      );

      const [createdKey] = await client.createCryptoKey({
        parent,
        cryptoKeyId: `company-${companyId}`,
        cryptoKey: {
          purpose:         "ASYMMETRIC_SIGN",
          versionTemplate: { algorithm: "EC_SIGN_P256_SHA256" },
        },
      });

      if (!createdKey.name) {
        throw new Error("KMS_CREATE_KEY_NO_NAME: createCryptoKey returned no name");
      }

      await waitForVersionReady(client, versionOneResourceName(createdKey.name));

      return { kind: "kms", resourceName: versionOneResourceName(createdKey.name) };
    },

    async exportPublicKey(handle: KeyHandle): Promise<string> {
      if (handle.kind !== "kms") {
        throw new Error("WRONG_KEY_KIND: exportPublicKey requires a KMS handle");
      }

      const [pubKeyResp] = await client.getPublicKey({ name: handle.resourceName });
      if (!pubKeyResp.pem) {
        throw new Error("KMS_GET_PUBLIC_KEY_NO_PEM: KMS returned no PEM");
      }

      return pemSpkiToBase64(pubKeyResp.pem);
    },

    async sign(handle: KeyHandle, message: Uint8Array): Promise<Signature> {
      if (handle.kind !== "kms") {
        throw new Error("WRONG_KEY_KIND: sign requires a KMS handle");
      }

      // Pass raw bytes — KMS hashes with SHA256 internally.
      // Do NOT pre-hash here; verifyEcdsaP256 uses createVerify('SHA256')
      // which also hashes, and double-hashing breaks verification.
      const [signResp] = await client.asymmetricSign({
        name: handle.resourceName,
        data: message,
      });

      if (!signResp.signature) {
        throw new Error("KMS_SIGN_NO_SIGNATURE: asymmetricSign returned no signature");
      }

      const sigBytes = toUint8Array(signResp.signature);
      return Buffer.from(sigBytes).toString("base64url");
    },

    async verify(publicKey: string, message: Uint8Array, sig: string): Promise<boolean> {
      return verifyEcdsaP256(publicKey, message, sig);
    },

    hash:        sha256,
    randomBytes,
  };
}

// ─── Standalone helpers ───────────────────────────────────────────────────────

export async function createCompanyRootKey(
  client: KeyManagementServiceClient,
  opts: { projectId: string; location: string; keyRing: string; companyId: string },
): Promise<KeyHandle> {
  const provider = makeKmsCryptoProvider({
    projectId: opts.projectId,
    location:  opts.location,
    keyRing:   opts.keyRing,
    client,
  });
  return provider.createCompanyRootKey(opts.companyId);
}

export async function signWithKms(
  client: KeyManagementServiceClient,
  handle: KeyHandle,
  message: Uint8Array,
): Promise<Signature> {
  if (handle.kind !== "kms") {
    throw new Error("WRONG_KEY_KIND: signWithKms requires a KMS handle");
  }

  // Pass raw bytes — KMS hashes with SHA256 internally.
  const [signResp] = await client.asymmetricSign({
    name: handle.resourceName,
    data: message,
  });

  if (!signResp.signature) {
    throw new Error("KMS_SIGN_NO_SIGNATURE");
  }

  const sigBytes = toUint8Array(signResp.signature);
  return Buffer.from(sigBytes).toString("base64url");
}

export async function exportPublicKey(
  client: KeyManagementServiceClient,
  handle: KeyHandle,
): Promise<string> {
  if (handle.kind !== "kms") {
    throw new Error("WRONG_KEY_KIND: exportPublicKey requires a KMS handle");
  }

  const [resp] = await client.getPublicKey({ name: handle.resourceName });
  if (!resp.pem) throw new Error("KMS_GET_PUBLIC_KEY_NO_PEM");
  return pemSpkiToBase64(resp.pem);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function pemSpkiToBase64(pem: string): string {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return body;
}

function toUint8Array(value: Buffer | string | Uint8Array | unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value))      return new Uint8Array(value);
  if (typeof value === "string")   return new Uint8Array(Buffer.from(value, "base64"));
  throw new Error("UNEXPECTED_KMS_PAYLOAD_TYPE");
}

async function waitForVersionReady(
  client: KeyManagementServiceClient,
  versionName: string,
): Promise<void> {
  const start = Date.now();
  const deadline = start + 10_000;

  while (Date.now() < deadline) {
    const [version] = await client.getCryptoKeyVersion({ name: versionName });
    if (version.state === "ENABLED") return;
    if (version.state === "DESTROYED" || version.state === "DESTROY_SCHEDULED") {
      throw new Error(`KMS_VERSION_DESTROYED: ${versionName}`);
    }
    await sleep(250);
  }

  throw new Error(`KMS_VERSION_NOT_READY: ${versionName} did not reach ENABLED within 10s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { nodeCrypto as __nodeCrypto };