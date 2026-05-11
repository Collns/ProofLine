/**
 * @file gcp-kms.test.ts
 * @module packages/crypto/src/__tests__
 *
 * Integration test for the GCP KMS provider.
 *
 * Strategy:
 *   - We do NOT hit real Cloud KMS.  Real KMS in tests requires
 *     GCP credentials and costs money per call.
 *   - Instead we build a FakeKeyManagementServiceClient that
 *     implements the same surface area we use (createCryptoKey,
 *     getCryptoKeyVersion, getPublicKey, asymmetricSign, keyRingPath)
 *     using node:crypto P-256 keys.
 *   - This proves the wiring is correct end-to-end:
 *     createCompanyRootKey → signWithKms → exportPublicKey →
 *     verifyEcdsaP256 returns true.
 *
 * Acceptance criterion from PFL-011:
 *   "creates key, signs a message, verification succeeds with
 *    exported pubkey."
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as nodeCrypto from "node:crypto";
import { makeKmsCryptoProvider } from "../providers/gcp-kms.js";
import { verifyEcdsaP256 } from "../verify.js";

// ─── Fake KMS client ─────────────────────────────────────────────────────────

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

    // Real KMS receives raw bytes and hashes internally with SHA256.
    // Node's createSign('SHA256') does the same — hash then sign —
    // so verifyEcdsaP256 (which also uses createVerify('SHA256')) round-trips correctly.
    const signer = nodeCrypto.createSign("SHA256");
    signer.update(req.data);
    signer.end();
    const signature = signer.sign({ key: key.privateKey, dsaEncoding: "der" });

    return [{ signature: Buffer.from(signature) }];
  }

  // Test-only: peek at internal state.
  _getKey(versionName: string): StoredKey | undefined {
    return this.keys.get(versionName);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeKmsCryptoProvider — integration", () => {
  let fakeClient: FakeKeyManagementServiceClient;
  let provider:   ReturnType<typeof makeKmsCryptoProvider>;

  beforeEach(() => {
    fakeClient = new FakeKeyManagementServiceClient();
    provider = makeKmsCryptoProvider({
      projectId: "proofline-test",
      location:  "global",
      keyRing:   "proofline-roots",
      client: fakeClient as unknown as import("@google-cloud/kms").KeyManagementServiceClient,
    });
  });

  // ── Acceptance test ────────────────────────────────────────────────────────

  it("creates key → signs message → verifies with exported pubkey", async () => {
    // 1. Create the company root key.
    const handle = await provider.createCompanyRootKey("co_acme_42");
    expect(handle.kind).toBe("kms");
    if (handle.kind !== "kms") return;
    expect(handle.resourceName).toBe(
      "projects/proofline-test/locations/global/keyRings/proofline-roots/" +
      "cryptoKeys/company-co_acme_42/cryptoKeyVersions/1"
    );

    // 2. Export the public key (SPKI base64).
    const pubKeyB64 = await provider.exportPublicKey(handle);
    expect(pubKeyB64).toMatch(/^[A-Za-z0-9+/=]+$/);  // base64
    expect(pubKeyB64).not.toContain("-----BEGIN");   // PEM armor stripped

    // 3. Sign an arbitrary message via KMS.
    const message   = new TextEncoder().encode("ProofLine canonical bytes");
    const signature = await provider.sign(handle, message);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);   // base64url

    // 4. Verify the signature with the exported pubkey.
    const ok = await verifyEcdsaP256(pubKeyB64, message, signature);
    expect(ok).toBe(true);
  });

  // ── Negative tests ────────────────────────────────────────────────────────

  it("verification fails when the message is tampered", async () => {
    const handle    = await provider.createCompanyRootKey("co_tamper");
    const pubKeyB64 = await provider.exportPublicKey(handle);
    const message   = new TextEncoder().encode("original");
    const signature = await provider.sign(handle, message);

    const tampered = new TextEncoder().encode("modified");
    const ok = await verifyEcdsaP256(pubKeyB64, tampered, signature);
    expect(ok).toBe(false);
  });

  it("verification fails when the signature is tampered", async () => {
    const handle    = await provider.createCompanyRootKey("co_sig_tamper");
    const pubKeyB64 = await provider.exportPublicKey(handle);
    const message   = new TextEncoder().encode("hello");
    const signature = await provider.sign(handle, message);

    // Flip a base64url character in the middle.
    const idx   = 8;
    const ch    = signature[idx];
    const newCh = ch === "A" ? "B" : "A";
    const tampered = signature.slice(0, idx) + newCh + signature.slice(idx + 1);
    const ok = await verifyEcdsaP256(pubKeyB64, message, tampered);
    expect(ok).toBe(false);
  });

  it("rejects sign() called with a non-KMS handle", async () => {
    const message = new TextEncoder().encode("x");
    await expect(
      provider.sign({ kind: "webauthn", credentialId: "abc" }, message)
    ).rejects.toThrow(/WRONG_KEY_KIND/);
  });

  it("rejects exportPublicKey() called with a non-KMS handle", async () => {
    await expect(
      provider.exportPublicKey({ kind: "webauthn", credentialId: "abc" })
    ).rejects.toThrow(/WRONG_KEY_KIND/);
  });

  it("two different companies produce different keys + signatures", async () => {
    const h1 = await provider.createCompanyRootKey("co_1");
    const h2 = await provider.createCompanyRootKey("co_2");
    const p1 = await provider.exportPublicKey(h1);
    const p2 = await provider.exportPublicKey(h2);
    expect(p1).not.toBe(p2);

    const msg = new TextEncoder().encode("same bytes");
    const s1  = await provider.sign(h1, msg);
    const s2  = await provider.sign(h2, msg);

    // Each pubkey only verifies its own signature.
    expect(await verifyEcdsaP256(p1, msg, s1)).toBe(true);
    expect(await verifyEcdsaP256(p2, msg, s2)).toBe(true);
    expect(await verifyEcdsaP256(p1, msg, s2)).toBe(false);
    expect(await verifyEcdsaP256(p2, msg, s1)).toBe(false);
  });

  it("creating the same companyId twice throws ALREADY_EXISTS", async () => {
    await provider.createCompanyRootKey("co_dupe");
    await expect(provider.createCompanyRootKey("co_dupe")).rejects.toThrow(/ALREADY_EXISTS/);
  });

  it("hash() and randomBytes() are wired through to crypto helpers", () => {
    const h = provider.hash(new TextEncoder().encode("test"));
    expect(h).toBeInstanceOf(Uint8Array);
    expect(h.length).toBe(32);

    const rb = provider.randomBytes(16);
    expect(rb.length).toBe(16);
  });
});