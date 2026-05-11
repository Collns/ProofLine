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
 *     SHA-256 digest of the message to KMS and getting back a DER
 *     ECDSA signature.
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
  // KMS createCryptoKey returns a key path; signing/exporting need a version path.
  // Version 1 is auto-created with the key.
  return `${keyResourceName}/cryptoKeyVersions/1`;
}

// ─── Public — provider factory ────────────────────────────────────────────────

/**
 * Build a CryptoProvider backed by Google Cloud KMS.
 *
 * The returned provider implements the CryptoProvider interface from
 * ../types.ts.  sign() requires a KMS-kind KeyHandle and only handles
 * P-256 SHA-256 keys.  verify() is pure JS — no KMS call.
 */
export function makeKmsCryptoProvider(config: GcpKmsConfig): CryptoProvider & {
  createCompanyRootKey(companyId: string): Promise<KeyHandle>;
  exportPublicKey(handle: KeyHandle): Promise<string>;
} {
  const client = config.client ?? new KeyManagementServiceClient();

  return {
    /**
     * Create a new EC_SIGN_P256_SHA256 key for a company.
     * Returns a KeyHandle pointing at version 1 of the key.
     */
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

      // Wait briefly for v1 to become enabled — KMS auto-creates v1
      // with the key, but it goes through PENDING_GENERATION first.
      await waitForVersionReady(client, versionOneResourceName(createdKey.name));

      return { kind: "kms", resourceName: versionOneResourceName(createdKey.name) };
    },

    /**
     * Export the SPKI-encoded public key as base64 — the format ProofLine
     * stores in companies/{companyId}.rootPublicKey.
     *
     * KMS returns the public key as PEM ("-----BEGIN PUBLIC KEY-----..."),
     * so we strip the armor and re-encode the DER bytes as base64.
     */
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

    /**
     * Sign a message via KMS asymmetricSign.  KMS expects the *digest*
     * of the message, not the raw bytes — we hash here.  The returned
     * signature is DER-encoded ECDSA, base64url for storage.
     */
    async sign(handle: KeyHandle, message: Uint8Array): Promise<Signature> {
      if (handle.kind !== "kms") {
        throw new Error("WRONG_KEY_KIND: sign requires a KMS handle");
      }

      const digest = sha256(message);

      const [signResp] = await client.asymmetricSign({
        name:   handle.resourceName,
        digest: { sha256: digest },
      });

      if (!signResp.signature) {
        throw new Error("KMS_SIGN_NO_SIGNATURE: asymmetricSign returned no signature");
      }

      // KMS returns Buffer | string | Uint8Array depending on transport.
      const sigBytes = toUint8Array(signResp.signature);
      return Buffer.from(sigBytes).toString("base64url");
    },

    /**
     * Verify is pure JS — no KMS round-trip.  The public key must be
     * the SPKI base64 string returned by exportPublicKey().
     */
    async verify(publicKey: string, message: Uint8Array, sig: string): Promise<boolean> {
      return verifyEcdsaP256(publicKey, message, sig);
    },

    hash:        sha256,
    randomBytes,
  };
}

// ─── Standalone helpers (callable without building a full provider) ──────────

/**
 * Create a new company root key.  Convenience wrapper for callers that
 * only need this single operation (e.g. the onboarding `finalize` handler).
 */
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

/**
 * Sign a message with an existing KMS key handle.  Convenience wrapper
 * for one-off signs (e.g. issuing a role credential during finalize).
 */
export async function signWithKms(
  client: KeyManagementServiceClient,
  handle: KeyHandle,
  message: Uint8Array,
): Promise<Signature> {
  if (handle.kind !== "kms") {
    throw new Error("WRONG_KEY_KIND: signWithKms requires a KMS handle");
  }

  const digest = sha256(message);

  const [signResp] = await client.asymmetricSign({
    name:   handle.resourceName,
    digest: { sha256: digest },
  });

  if (!signResp.signature) {
    throw new Error("KMS_SIGN_NO_SIGNATURE");
  }

  const sigBytes = toUint8Array(signResp.signature);
  return Buffer.from(sigBytes).toString("base64url");
}

/**
 * Export the SPKI public key as base64.  Convenience wrapper.
 */
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

/**
 * Convert a PEM-armored SPKI key to base64 of the DER bytes.
 * Strips the BEGIN/END markers and concatenates the body lines.
 */
function pemSpkiToBase64(pem: string): string {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  // body is already base64-encoded DER — return as-is to match how
  // the rest of the codebase stores SPKI ("base64", not "base64url").
  return body;
}

/**
 * KMS proto fields can be Buffer | string | Uint8Array. Normalize.
 */
function toUint8Array(value: Buffer | string | Uint8Array | unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value))      return new Uint8Array(value);
  if (typeof value === "string")   return new Uint8Array(Buffer.from(value, "base64"));
  throw new Error("UNEXPECTED_KMS_PAYLOAD_TYPE");
}

/**
 * Poll the key-version state until it's ENABLED.  KMS goes
 * PENDING_GENERATION → ENABLED in a few hundred ms typically.
 * Cap at ~10 seconds.
 */
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

// nodeCrypto re-exported for tests that want to validate the
// SPKI roundtrip locally (not used in production paths).
export { nodeCrypto as __nodeCrypto };