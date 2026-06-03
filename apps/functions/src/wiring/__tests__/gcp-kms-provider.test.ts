/**
 * @file gcp-kms-provider.test.ts
 * @module apps/functions/src/wiring/__tests__
 *
 * PFL-126 — adapter that maps @proofline/crypto's KMS provider to the
 * onboarding-handler-facing `KmsProvider` interface.
 *
 * Strategy mirrors packages/crypto's gcp-kms.test.ts: a fake KMS
 * client backed by node:crypto P-256 keys, so we exercise the real
 * adapter end-to-end (createCompanyRootKey → exportPublicKey →
 * signWithKms) and confirm the signature round-trips through
 * verifyEcdsaP256.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as nodeCrypto from "node:crypto";
import { verifyEcdsaP256 } from "@proofline/crypto";

import {
  makeRealKmsProvider,
  resolveKmsConfigFromEnv,
} from "../gcp-kms-provider.js";

// ─── Fake KMS client (same shape as packages/crypto's test fake) ─────────────

interface StoredKey {
  name:        string;
  versionName: string;
  privateKey:  nodeCrypto.KeyObject;
  publicKey:   nodeCrypto.KeyObject;
  state:       "PENDING_GENERATION" | "ENABLED";
}

class FakeKeyManagementServiceClient {
  private keys = new Map<string, StoredKey>();

  keyRingPath(projectId: string, location: string, keyRing: string): string {
    return `projects/${projectId}/locations/${location}/keyRings/${keyRing}`;
  }

  async createCryptoKey(req: {
    parent:      string;
    cryptoKeyId: string;
    cryptoKey:   { purpose: string; versionTemplate: { algorithm: string } };
  }): Promise<[{ name: string }]> {
    const keyName     = `${req.parent}/cryptoKeys/${req.cryptoKeyId}`;
    const versionName = `${keyName}/cryptoKeyVersions/1`;

    if (this.keys.has(versionName)) {
      throw new Error(`ALREADY_EXISTS: ${keyName}`);
    }

    expect(req.cryptoKey.purpose).toBe("ASYMMETRIC_SIGN");
    expect(req.cryptoKey.versionTemplate.algorithm).toBe("EC_SIGN_P256_SHA256");

    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });

    this.keys.set(versionName, {
      name:        keyName,
      versionName,
      privateKey,
      publicKey,
      state: "ENABLED",
    });

    return [{ name: keyName }];
  }

  async getCryptoKeyVersion(req: { name: string }): Promise<[{ state: string }]> {
    const key = this.keys.get(req.name);
    if (!key) throw new Error(`NOT_FOUND: ${req.name}`);
    return [{ state: key.state }];
  }

  async getPublicKey(req: { name: string }): Promise<[{ pem: string }]> {
    const key = this.keys.get(req.name);
    if (!key) throw new Error(`NOT_FOUND: ${req.name}`);
    const pem = key.publicKey.export({ type: "spki", format: "pem" }) as string;
    return [{ pem }];
  }

  async asymmetricSign(req: {
    name: string;
    data: Uint8Array;
  }): Promise<[{ signature: Buffer }]> {
    const key = this.keys.get(req.name);
    if (!key) throw new Error(`NOT_FOUND: ${req.name}`);

    // KMS hashes raw bytes with SHA-256 internally. node's createSign
    // does the same — same hash, same curve — so verifyEcdsaP256
    // (which also uses createVerify('SHA256')) round-trips.
    const signer = nodeCrypto.createSign("SHA256");
    signer.update(req.data);
    signer.end();
    const signature = signer.sign({ key: key.privateKey, dsaEncoding: "der" });

    return [{ signature: Buffer.from(signature) }];
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PFL-126 makeRealKmsProvider — adapter integration", () => {
  let fakeClient: FakeKeyManagementServiceClient;

  beforeEach(() => {
    fakeClient = new FakeKeyManagementServiceClient();
  });

  it("creates an EC P-256 key, exports SPKI, signs, and verifies", async () => {
    const provider = makeRealKmsProvider({
      projectId: "p",
      location:  "global",
      keyRing:   "proofline-roots",
      client:    fakeClient as unknown as ConstructorParameters<typeof Object>[0],
    } as Parameters<typeof makeRealKmsProvider>[0]);

    const { keyName } = await provider.createCompanyRootKey("acme-title");
    expect(keyName).toBe(
      "projects/p/locations/global/keyRings/proofline-roots/cryptoKeys/company-acme-title/cryptoKeyVersions/1",
    );

    const spkiB64 = await provider.exportPublicKey(keyName);
    // SPKI base64 (no PEM headers, no whitespace). The leading byte of
    // an EC P-256 SPKI is 0x30 (DER SEQUENCE).
    expect(spkiB64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const spkiBytes = Buffer.from(spkiB64, "base64");
    expect(spkiBytes[0]).toBe(0x30);

    const message = new TextEncoder().encode("hello-proofline");
    const sig = await provider.signWithKms(keyName, message);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);                  // base64url, no padding

    const valid = await verifyEcdsaP256(spkiB64, message, sig);
    expect(valid).toBe(true);
  });

  it("returns the version-1 resource name from createCompanyRootKey", async () => {
    const provider = makeRealKmsProvider({
      projectId: "p2",
      location:  "us-east1",
      keyRing:   "kr-test",
      client:    fakeClient as never,
    } as Parameters<typeof makeRealKmsProvider>[0]);

    const { keyName } = await provider.createCompanyRootKey("co-1");
    expect(keyName.endsWith("/cryptoKeyVersions/1")).toBe(true);
  });
});

// ─── resolveKmsConfigFromEnv ─────────────────────────────────────────────────

describe("PFL-126 resolveKmsConfigFromEnv", () => {
  it("returns null when GOOGLE_CLOUD_PROJECT is unset", () => {
    const cfg = resolveKmsConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });

  it("returns null when KMS_KEYRING is unset (no safe default)", () => {
    const cfg = resolveKmsConfigFromEnv({
      GOOGLE_CLOUD_PROJECT: "proofline-prod",
    } as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });

  it("resolves all three values when env is fully set", () => {
    const cfg = resolveKmsConfigFromEnv({
      GOOGLE_CLOUD_PROJECT: "proofline-prod",
      KMS_LOCATION:         "us-east1",
      KMS_KEYRING:          "proofline-roots",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      projectId: "proofline-prod",
      location:  "us-east1",
      keyRing:   "proofline-roots",
    });
  });

  it("defaults location to 'global' when KMS_LOCATION is absent", () => {
    const cfg = resolveKmsConfigFromEnv({
      GOOGLE_CLOUD_PROJECT: "p",
      KMS_KEYRING:          "kr",
    } as NodeJS.ProcessEnv);
    expect(cfg?.location).toBe("global");
  });

  it("accepts KMS_PROJECT as an alias for the project id", () => {
    const cfg = resolveKmsConfigFromEnv({
      KMS_PROJECT: "proofline-staging",
      KMS_KEYRING: "kr",
    } as NodeJS.ProcessEnv);
    expect(cfg?.projectId).toBe("proofline-staging");
  });
});
