import { describe, it, expect, vi } from 'vitest';
import { verifyEnvelope } from '../verify.js';
import {
  buildScenario,
  buildEnvelope,
  makeEmailPayload,
  makeWirePayload,
  makeBilateralPayload,
  hashPayload,
  makeRoleCredential,
  signBytes,
  generateKeyPair,
  InMemoryRegistry,
} from './helpers.js';
import { canonicalize } from '@proofline/canonical';
import * as nodeCrypto from 'node:crypto';
import type { Hex32 } from '../types.js';
import type { SignedEnvelope } from '@proofline/types';

const ANCHOR_ROOT = '0xdeadbeef' as Hex32;

// ─── Happy paths ──────────────────────────────────────────────────────────────

describe('happy paths', () => {
  it('verified state for valid email envelope', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'verified') {
      expect(result.signers).toHaveLength(1);
      expect(result.signers[0].userId).toBe('user-a');
      expect(result.signers[0].companyLegalName).toBe('Company A Inc.');
      expect(result.anchor.root).toBe(ANCHOR_ROOT);
    } else {
      throw new Error(`expected verified, got ${JSON.stringify(result)}`);
    }
  });

  it('verified state for valid wire envelope (single-sig within authority)', async () => {
    const s = buildScenario({ perEmailLimitUsd: 10000 });
    const payload = makeWirePayload({ amount: 5000 });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'wire',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toBe('verified');
    } else {
      throw new Error(`expected verified, got ${JSON.stringify(result)}`);
    }
  });

  it('verified state for cosigned wire envelope (over per-email limit)', async () => {
    const s = buildScenario({ perEmailLimitUsd: 1000 });
    // both signers have limit 1000 but amount is 50000 — cosign satisfies policy
    const payload = makeWirePayload({ amount: 50000 });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'wire',
      signerSpecs: [
        { userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey },
        { userId: 'user-b', credentialId: 'cred-b', privateKey: s.userBKp.privateKey },
      ],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'verified') {
      expect(result.signers).toHaveLength(2);
    } else {
      throw new Error(`expected verified, got ${JSON.stringify(result)}`);
    }
  });

  it('bilateral state for valid bilateral envelope', async () => {
    const s = buildScenario();
    const payload = makeBilateralPayload({
      drafterCompanyId: 'company-a',
      counterpartyCompanyId: 'company-b',
    });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'bilateral',
      signerSpecs: [
        { userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey },
        { userId: 'user-b', credentialId: 'cred-b', privateKey: s.userBKp.privateKey },
      ],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok && result.state === 'bilateral') {
      expect(result.signers).toHaveLength(2);
    } else {
      throw new Error(`expected bilateral, got ${JSON.stringify(result)}`);
    }
  });
});

// ─── Check failures ───────────────────────────────────────────────────────────

describe('PAYLOAD_HASH_MISMATCH', () => {
  it('rejects when payload is tampered after signing', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });
    // Tamper: recompute hash of a different payload
    const tamperedPayload = { ...payload, subject: 'TAMPERED' };
    const tampered = { ...envelope, payload: tamperedPayload };

    const result = await verifyEnvelope({ envelope: tampered as never, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PAYLOAD_HASH_MISMATCH');
  });
});

describe('COMPANY_UNKNOWN', () => {
  it('rejects when signer company is not in registry', async () => {
    const s = buildScenario();
    // Remove company A from registry
    const reg = new InMemoryRegistry();
    reg.addUser(s.userA).addCredential(s.credA).addAnchor(s.anchor);

    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: reg });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COMPANY_UNKNOWN');
  });
});

describe('COMPANY_SUSPENDED', () => {
  it('rejects when company is suspended', async () => {
    const s = buildScenario();
    const reg = new InMemoryRegistry();
    reg
      .addCompany({ ...s.companyA, status: 'suspended' })
      .addUser(s.userA)
      .addCredential(s.credA)
      .addAnchor(s.anchor);

    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: reg });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COMPANY_SUSPENDED');
  });
});

describe('USER_DEACTIVATED', () => {
  it('rejects when user is deactivated', async () => {
    const s = buildScenario();
    const reg = new InMemoryRegistry();
    reg
      .addCompany(s.companyA)
      .addUser({ ...s.userA, status: 'deactivated' })
      .addCredential(s.credA)
      .addAnchor(s.anchor);

    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: reg });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('USER_DEACTIVATED');
  });
});

describe('CREDENTIAL_REVOKED', () => {
  it('rejects when credential is revoked', async () => {
    const s = buildScenario();
    s.registry.revokeCredential('cred-a');

    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CREDENTIAL_REVOKED');
  });
});

describe('SIGNATURE_INVALID', () => {
  it('promotes to suspected_spoof when signature is over different bytes for a verified-domain signer', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });
    // Replace sig with a sig over garbage bytes — signer identity still
    // resolves to verified company-a, so per F-VER-07 result is suspected_spoof.
    const badSig = signBytes(s.userAKp.privateKey, new Uint8Array(32).fill(0));
    const tampered = {
      ...envelope,
      signers: [{ ...envelope.signers[0], sig: badSig }],
    };

    const result = await verifyEnvelope({ envelope: tampered as never, registry: s.registry });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('suspected_spoof');
  });
});

describe('ROLE_CREDENTIAL_INVALID', () => {
  it('rejects when credential issuer sig is invalid', async () => {
    const s = buildScenario();
    // Create a credential with a bad issuerSig (signed by wrong key)
    const wrongKp = generateKeyPair();
    const badCred = makeRoleCredential({
      credentialId: 'cred-a-bad',
      userId: 'user-a',
      companyId: 'company-a',
      publicKey: s.userAKp.publicKeySpkiBase64,
      issuerPrivateKey: wrongKp.privateKey,  // wrong key
    });

    const reg = new InMemoryRegistry();
    reg
      .addCompany(s.companyA)
      .addUser(s.userA)
      .addCredential(badCred)
      .addAnchor(s.anchor);

    const payload = makeEmailPayload();
    // Build envelope with cred-a-bad
    const message = canonicalize(payload);
    const sig = signBytes(s.userAKp.privateKey, message);
    const envelope = {
      v: 1 as const,
      payloadType: 'email' as const,
      payload,
      payloadHash: hashPayload(payload),
      signers: [{ userId: 'user-a', credentialId: 'cred-a-bad', role: 'employee', sig, signedAt: Math.floor(Date.now() / 1000), sessionId: null }],
      anchorRoot: ANCHOR_ROOT,
      anchorTxHash: null,
      anchorBlockNumber: null,
    };

    const result = await verifyEnvelope({ envelope, registry: reg });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROLE_CREDENTIAL_INVALID');
  });
});

describe('ANCHOR_MISSING', () => {
  it('rejects when envelope has no anchorRoot', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: null,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ANCHOR_MISSING');
  });
});

describe('ANCHOR_NOT_ON_CHAIN', () => {
  it('rejects when anchor root is not in registry', async () => {
    const s = buildScenario();
    // registry has no anchor for this root
    const payload = makeEmailPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: '0xunknownroot' as Hex32,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ANCHOR_NOT_ON_CHAIN');
  });
});

describe('PAYLOAD_EXPIRED', () => {
  it('rejects when payload expiresAt is in the past', async () => {
    const s = buildScenario();
    const pastSec = Math.floor(Date.now() / 1000) - 7200;
    const payload = makeEmailPayload({ expiresAt: pastSec });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PAYLOAD_EXPIRED');
  });
});

describe('NONCE_REPLAYED', () => {
  it('rejects when nonce has already been used', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ nonce: 'unique-nonce-already-used1' });
    s.registry.addNonce('unique-nonce-already-used1');
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NONCE_REPLAYED');
  });
});

describe('POLICY_AUTHORITY_EXCEEDED_AT_SIGNING', () => {
  it('rejects single-sig over per-email limit with no cosigner', async () => {
    const s = buildScenario({ perEmailLimitUsd: 1000 });
    const payload = makeWirePayload({ amount: 50000 });
    // Only one signer, amount exceeds limit
    const envelope = buildEnvelope({
      payload,
      payloadType: 'wire',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('POLICY_AUTHORITY_EXCEEDED_AT_SIGNING');
  });
});

// ─── PFL-125: WebAuthn signature verification ────────────────────────────────

/**
 * Build a WebAuthn-style signature for the test scenario. Authenticators
 * sign `SHA256(authData || SHA256(clientDataJSON))` — we replicate that
 * here using node:crypto so verifyEnvelope's checkSignatures path
 * exercises the real reconstruction logic.
 */
function buildWebauthnSig(opts: {
  privateKey: nodeCrypto.KeyObject;
  challenge:  string;            // value to embed as clientData.challenge
  origin?:    string;
}): { sig: string; authenticatorData: string; clientDataJSON: string } {
  const clientData = JSON.stringify({
    type:      'webauthn.get',
    challenge: opts.challenge,
    origin:    opts.origin ?? 'https://proofline-sign.web.app',
    crossOrigin: false,
  });
  const clientDataBytes = Buffer.from(clientData, 'utf8');
  // 37 bytes is the minimum authenticator data size (rpIdHash[32] +
  // flags[1] + signCount[4]). Contents don't matter for the verifier —
  // it only re-hashes whatever bytes we hand it.
  const authData = Buffer.alloc(37, 0xaa);
  const clientDataHash = nodeCrypto.createHash('sha256').update(clientDataBytes).digest();
  const signedMessage = Buffer.concat([authData, clientDataHash]);
  const signer = nodeCrypto.createSign('SHA256');
  signer.update(signedMessage);
  signer.end();
  const sig = signer.sign({ key: opts.privateKey, dsaEncoding: 'der' }).toString('base64url');
  return {
    sig,
    authenticatorData: authData.toString('base64url'),
    clientDataJSON:    clientDataBytes.toString('base64url'),
  };
}

describe('PFL-125: WebAuthn signature verification', () => {
  it('verifies an envelope whose signer carries authenticatorData + clientDataJSON', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const payloadHash = hashPayload(payload);
    const { sig, authenticatorData, clientDataJSON } = buildWebauthnSig({
      privateKey: s.userAKp.privateKey,
      challenge:  payloadHash,
    });
    const envelope: SignedEnvelope = {
      v: 1,
      payloadType: 'email',
      payload,
      payloadHash,
      signers: [{
        userId:            'user-a',
        credentialId:      'cred-a',
        role:              'employee',
        sig,
        signedAt:          Math.floor(Date.now() / 1000),
        sessionId:         null,
        authenticatorData,
        clientDataJSON,
      }],
      anchorRoot:        ANCHOR_ROOT,
      anchorTxHash:      null,
      anchorBlockNumber: null,
    };

    const result = await verifyEnvelope({ envelope, registry: s.registry });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('verified');
  });

  it('promotes to suspected_spoof when the WebAuthn signature is over different bytes', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const payloadHash = hashPayload(payload);
    const { sig: goodSig, authenticatorData, clientDataJSON } = buildWebauthnSig({
      privateKey: s.userAKp.privateKey,
      challenge:  payloadHash,
    });
    // Tamper: replace the authenticatorData with a different blob so the
    // reconstructed signed-message no longer matches what was signed.
    const tamperedAuthData = Buffer.alloc(37, 0xbb).toString('base64url');
    const envelope: SignedEnvelope = {
      v: 1,
      payloadType: 'email',
      payload,
      payloadHash,
      signers: [{
        userId:            'user-a',
        credentialId:      'cred-a',
        role:              'employee',
        sig:               goodSig,
        signedAt:          Math.floor(Date.now() / 1000),
        sessionId:         null,
        authenticatorData: tamperedAuthData,
        clientDataJSON,
      }],
      anchorRoot:        ANCHOR_ROOT,
      anchorTxHash:      null,
      anchorBlockNumber: null,
    };

    const result = await verifyEnvelope({ envelope, registry: s.registry });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('suspected_spoof');
  });

  it('promotes to suspected_spoof when clientDataJSON.challenge does not match payloadHash (replay across payloads)', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const payloadHash = hashPayload(payload);
    // Sign with a challenge that binds to a DIFFERENT payload — the
    // verifier must reject even though the underlying ECDSA math works.
    const { sig, authenticatorData, clientDataJSON } = buildWebauthnSig({
      privateKey: s.userAKp.privateKey,
      challenge:  'this-is-some-other-payloads-hash',
    });
    const envelope: SignedEnvelope = {
      v: 1,
      payloadType: 'email',
      payload,
      payloadHash,
      signers: [{
        userId:            'user-a',
        credentialId:      'cred-a',
        role:              'employee',
        sig,
        signedAt:          Math.floor(Date.now() / 1000),
        sessionId:         null,
        authenticatorData,
        clientDataJSON,
      }],
      anchorRoot:        ANCHOR_ROOT,
      anchorTxHash:      null,
      anchorBlockNumber: null,
    };

    const result = await verifyEnvelope({ envelope, registry: s.registry });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('suspected_spoof');
  });

  it('legacySignatureFallback soft-skips a legacy envelope (no WebAuthn fields, bad raw sig) with a warning', async () => {
    const s = buildScenario();
    const payload = makeEmailPayload({ companyId: 'company-a' });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'email',
      signerSpecs: [{ userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey }],
      anchorRoot: ANCHOR_ROOT,
    });
    // Tamper raw sig — legacy fallback must still produce `verified`.
    const tampered = {
      ...envelope,
      signers: [{ ...envelope.signers[0], sig: signBytes(s.userAKp.privateKey, new Uint8Array(32).fill(0)) }],
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await verifyEnvelope({
        envelope: tampered as never,
        registry: s.registry,
        legacySignatureFallback: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.state).toBe('verified');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('BILATERAL_INCOMPLETE', () => {
  it('rejects bilateral payload with only one signer', async () => {
    const s = buildScenario();
    const payload = makeBilateralPayload({
      drafterCompanyId: 'company-a',
      counterpartyCompanyId: 'company-b',
    });
    const envelope = buildEnvelope({
      payload,
      payloadType: 'bilateral',
      signerSpecs: [
        { userId: 'user-a', credentialId: 'cred-a', privateKey: s.userAKp.privateKey },
      ],
      anchorRoot: ANCHOR_ROOT,
    });

    const result = await verifyEnvelope({ envelope, registry: s.registry });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BILATERAL_INCOMPLETE');
  });
});
