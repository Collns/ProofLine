import { describe, it, expect } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { makeOnboardingService } from '../service.js';
import { dnsTokenFor } from '../util.js';
import {
  makeDeps,
  makeStubDns,
  NOW,
} from './helpers.js';

const DOMAIN = 'acme.com';

async function startAndAdvanceTo(
  step:
    | 'dns_pending'
    | 'email_pending'
    | 'kyb_pending'
    | 'kyc_pending'
    | 'finalize_pending',
  depsOverrides: Parameters<typeof makeDeps>[0] = {},
) {
  const dnsRecords = new Map<string, string[][]>();
  const deps = makeDeps({ dns: makeStubDns(dnsRecords), ...depsOverrides });
  const svc = makeOnboardingService(deps);
  const started = await svc.start({ domain: DOMAIN });
  if (!started.ok) throw new Error('start failed');
  const onboardingId = started.value.onboardingId;

  if (step === 'dns_pending') return { svc, deps, onboardingId, started };

  dnsRecords.set(started.value.dnsChallenge.recordName, [
    [started.value.dnsChallenge.recordValue],
  ]);
  await svc.verifyDns({ onboardingId });

  if (step === 'email_pending') return { svc, deps, onboardingId, started };

  await svc.startEmailVerification({ onboardingId });
  await svc.verifyEmailCodes({
    onboardingId,
    adminCode: '111111',
    postmasterCode: '222222',
  });

  if (step === 'kyb_pending') return { svc, deps, onboardingId, started };

  await svc.runKyb({
    onboardingId,
    legalName: 'Acme Title Inc',
    ein: '12-3456789',
    state: 'DE',
  });

  if (step === 'kyc_pending') return { svc, deps, onboardingId, started };

  await svc.startOfficerKyc({
    onboardingId,
    officerEmail: 'officer@acme.com',
  });
  await svc.confirmOfficerKyc({
    onboardingId,
    vendorSessionId: 'stub_idv_xyz789',
  });
  return { svc, deps, onboardingId, started };
}

describe('steps — DNS challenge value', () => {
  it('is deterministic from onboardingId', () => {
    const a = dnsTokenFor('id-1');
    const b = dnsTokenFor('id-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(dnsTokenFor('id-2')).not.toBe(a);
  });
});

describe('steps — email codes', () => {
  it('admin and postmaster codes are 6-digit numeric and distinct', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('email_pending');
    const email = deps.email as ReturnType<typeof import('./helpers.js').makeStubEmail>;
    await svc.startEmailVerification({ onboardingId });
    expect(email.sent).toHaveLength(2);
    for (const e of email.sent) {
      expect(e.code).toMatch(/^\d{6}$/);
    }
    expect(email.sent[0].code).not.toBe(email.sent[1].code);
  });
});

describe('steps — KYB records vendorRef + KYC records vendorSessionId', () => {
  it('runKyb writes vendorRef into state for audit', async () => {
    const { deps, onboardingId } = await startAndAdvanceTo('kyc_pending');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.kybVendorRef).toBe('stub_biz_abc123');
    expect(stored?.kybFlags).toEqual([]);
  });

  it('startOfficerKyc writes vendorRef into state for audit', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('kyc_pending');
    await svc.startOfficerKyc({
      onboardingId,
      officerEmail: 'officer@acme.com',
    });
    const stored = await deps.store.get(onboardingId);
    expect(stored?.kycVendorRef).toBe('stub_idv_xyz789');
  });

  it('confirmOfficerKyc rejects mismatched vendorSessionId', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('kyc_pending');
    await svc.startOfficerKyc({
      onboardingId,
      officerEmail: 'officer@acme.com',
    });
    const result = await svc.confirmOfficerKyc({
      onboardingId,
      vendorSessionId: 'wrong-session',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KYC_FAILED');
  });
});

describe('steps — finalize', () => {
  it('finalize() creates root key via kmsProvisioner', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const provisioner = deps.kmsProvisioner as ReturnType<
      typeof import('./helpers.js').makeCryptoAndKms
    >['kmsProvisioner'];
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk-base64',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(true);
    expect(provisioner.calls).toBe(1);
    if (result.ok) expect(result.value.rootKeyHandle.kind).toBe('kms');
  });

  it('finalize() signs the first role credential with the root key', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk-base64',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // issuerSig should verify against the root public key over the canonicalized body
    const body = { ...result.value.firstRoleCredential };
    const sig = body.issuerSig;
    delete (body as { issuerSig?: string }).issuerSig;
    const canonical = JSON.stringify(body);
    const verified = await deps.crypto.verify(
      result.value.rootPublicKey,
      new TextEncoder().encode(canonical),
      sig,
    );
    expect(verified).toBe(true);
  });

  it('finalize() role credential has role=owner and matches officer credentialId', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk-base64',
      officerCredentialId: 'cred-officer',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.firstRoleCredential.role).toBe('owner');
    expect(result.value.firstRoleCredential.credentialId).toBe('cred-officer');
    expect(result.value.firstRoleCredential.publicKey).toBe('pk-base64');
  });

  it('finalize() includes anchor tx hash in returned state', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = await deps.store.get(onboardingId);
    expect(stored?.anchorTxHash).toBe(result.value.anchorTxHash);
    expect(stored?.anchorBlock).toBe(result.value.anchorBlock.toString());
    expect(stored?.step).toBe('finalized');
  });

  it('finalize() called twice is idempotent (returns cached, no duplicate KMS key)', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const provisioner = deps.kmsProvisioner as ReturnType<
      typeof import('./helpers.js').makeCryptoAndKms
    >['kmsProvisioner'];
    const first = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    const second = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.companyId).toBe(first.value.companyId);
      expect(second.value.anchorTxHash).toBe(first.value.anchorTxHash);
    }
    expect(provisioner.calls).toBe(1);
  });

  it('finalize() failure during anchor leaves step=finalize_pending (recoverable)', async () => {
    const failingAnchor = {
      buildTree: () => ({
        root: '0x00' as `0x${string}`,
        leaves: [],
        proofFor: () => null,
      }),
      postAnchor: async () => {
        throw new Error('rpc timeout');
      },
      readAnchor: async () => null,
      verifyProof: () => true,
    };
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending', {
      anchor: failingAnchor as unknown as NonNullable<Parameters<typeof makeDeps>[0]>['anchor'],
    });
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ANCHOR_FAILED');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('finalize_pending');
  });

  it('finalize() failure during KMS leaves step=finalize_pending (recoverable)', async () => {
    const failingKms = {
      async createCompanyRootKey() {
        throw new Error('kms unavailable');
      },
    };
    const { svc, deps, onboardingId } = await startAndAdvanceTo('finalize_pending', {
      kmsProvisioner: failingKms,
    });
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KMS_FAILED');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('finalize_pending');
  });

  it('finalize() out of order returns BAD_STATE', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('kyb_pending');
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_STATE');
  });
});

describe('steps — boundary cases', () => {
  it('verifyDns() on unknown onboardingId returns NOT_FOUND', async () => {
    const deps = makeDeps();
    const svc = makeOnboardingService(deps);
    const result = await svc.verifyDns({ onboardingId: 'does-not-exist' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('runKyb() out of order (called when step=email_pending) returns BAD_STATE', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('email_pending');
    const result = await svc.runKyb({
      onboardingId,
      legalName: 'X',
      ein: '12-3456789',
      state: 'DE',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_STATE');
  });

  it('start() persists createdAt = updatedAt = now()', async () => {
    const deps = makeDeps();
    const svc = makeOnboardingService(deps);
    const started = await svc.start({ domain: DOMAIN });
    if (!started.ok) throw new Error();
    const stored = await deps.store.get(started.value.onboardingId);
    expect(stored?.createdAt).toBe(NOW);
    expect(stored?.updatedAt).toBe(NOW);
  });

  it('runKyb() with low-severity flag is treated as approved', async () => {
    const lowFlag = {
      verifyBusiness: async () => ({
        ok: true,
        vendorRef: 'stub_biz_low',
        flags: [{ type: 'address_format', severity: 'low' as const }],
        officers: [],
        raw: {},
      }),
      verifyOfficer: async () => ({
        ok: true,
        vendorRef: 'stub_idv',
        documentVerified: true,
        livenessConfirmed: true,
        matchedExpected: true,
        raw: {},
      }),
    };
    const { svc, deps, onboardingId } = await startAndAdvanceTo('kyb_pending', {
      kyb: lowFlag,
    });
    const result = await svc.runKyb({
      onboardingId,
      legalName: 'X',
      ein: '12-3456789',
      state: 'DE',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('approved');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('kyc_pending');
    void nodeCrypto;
  });
});
