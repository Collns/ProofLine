import { describe, it, expect } from 'vitest';
import { makeOnboardingService } from '../service.js';
import {
  makeDeps,
  makeStubKyb,
  makeStubDns,
  NOW,
} from './helpers.js';

const DOMAIN = 'acme.com';

async function startAndAdvanceTo(
  step: 'dns_pending' | 'email_pending' | 'kyb_pending' | 'kyc_pending' | 'finalize_pending',
  depsOverrides: Parameters<typeof makeDeps>[0] = {},
) {
  // Pre-resolve DNS so verifyDns() succeeds
  const onboardingId = 'id-1';
  const dnsRecords = new Map<string, string[][]>();
  // Pre-seed the deterministic challenge (matches dnsTokenFor('id-1'))
  // We'll fill in after start() resolves the actual record.
  const deps = makeDeps({ dns: makeStubDns(dnsRecords), ...depsOverrides });
  const svc = makeOnboardingService(deps);

  const started = await svc.start({ domain: DOMAIN });
  if (!started.ok) throw new Error('start failed');
  expect(started.value.onboardingId).toBe(onboardingId);

  if (step === 'dns_pending') return { svc, deps, onboardingId };

  dnsRecords.set(started.value.dnsChallenge.recordName, [
    [started.value.dnsChallenge.recordValue],
  ]);
  const dns = await svc.verifyDns({ onboardingId });
  if (!dns.ok) throw new Error('verifyDns failed');

  if (step === 'email_pending') return { svc, deps, onboardingId };

  await svc.startEmailVerification({ onboardingId });
  const verified = await svc.verifyEmailCodes({
    onboardingId,
    adminCode: '111111',
    postmasterCode: '222222',
  });
  if (!verified.ok) throw new Error('verifyEmailCodes failed');

  if (step === 'kyb_pending') return { svc, deps, onboardingId };

  const kyb = await svc.runKyb({
    onboardingId,
    legalName: 'Acme Title Inc',
    ein: '12-3456789',
    state: 'DE',
  });
  if (!kyb.ok) throw new Error('runKyb failed');

  if (step === 'kyc_pending') return { svc, deps, onboardingId };

  const kycStart = await svc.startOfficerKyc({
    onboardingId,
    officerEmail: 'officer@acme.com',
    officerName: 'Alice Chen',
  });
  if (!kycStart.ok) throw new Error('startOfficerKyc failed');
  const kycConfirm = await svc.confirmOfficerKyc({
    onboardingId,
    vendorSessionId: 'stub_idv_xyz789',
  });
  if (!kycConfirm.ok) throw new Error('confirmOfficerKyc failed');

  return { svc, deps, onboardingId };
}

describe('OnboardingService — start + state machine', () => {
  it('start() creates state with step=dns_pending and returns DNS challenge', async () => {
    const deps = makeDeps();
    const svc = makeOnboardingService(deps);
    const result = await svc.start({ domain: DOMAIN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dnsChallenge.recordName).toBe('_proofline.acme.com');
    expect(result.value.dnsChallenge.recordValue).toMatch(/^proofline-verify=[a-f0-9]{32}$/);
    const stored = await deps.store.get(result.value.onboardingId);
    expect(stored?.step).toBe('dns_pending');
  });

  it('verifyDns() with TXT record present advances to email_pending', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('email_pending');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('email_pending');
    expect(stored?.dnsVerifiedAt).toBe(NOW);
    void svc;
  });

  it('verifyDns() with TXT record absent returns DNS_NOT_FOUND', async () => {
    const deps = makeDeps();
    const svc = makeOnboardingService(deps);
    const started = await svc.start({ domain: DOMAIN });
    if (!started.ok) throw new Error();
    const result = await svc.verifyDns({ onboardingId: started.value.onboardingId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DNS_NOT_FOUND');
  });

  it('verifyDns() called when step=email_pending is idempotent (no error)', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('email_pending');
    const result = await svc.verifyDns({ onboardingId });
    expect(result.ok).toBe(true);
  });

  it('startEmailVerification() generates 2 codes and calls email.sendVerificationCode twice', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('email_pending');
    const email = deps.email as ReturnType<typeof import('./helpers.js').makeStubEmail>;
    const result = await svc.startEmailVerification({ onboardingId });
    expect(result.ok).toBe(true);
    expect(email.sent).toHaveLength(2);
    expect(email.sent[0].to).toBe('admin@acme.com');
    expect(email.sent[1].to).toBe('postmaster@acme.com');
    expect(email.sent[0].code).not.toBe(email.sent[1].code);
  });

  it('verifyEmailCodes() with both codes correct advances to kyb_pending', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('kyb_pending');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('kyb_pending');
    void svc;
  });

  it('verifyEmailCodes() with wrong adminCode returns CODE_INVALID and increments attempts', async () => {
    const { svc, deps, onboardingId } = await startAndAdvanceTo('email_pending');
    await svc.startEmailVerification({ onboardingId });
    const result = await svc.verifyEmailCodes({
      onboardingId,
      adminCode: '999999',
      postmasterCode: '222222',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CODE_INVALID');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.emailAttempts).toBe(1);
  });

  it('verifyEmailCodes() returns LOCKED_OUT after 5 wrong attempts', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('email_pending');
    await svc.startEmailVerification({ onboardingId });
    let lastError: { code: string } | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await svc.verifyEmailCodes({
        onboardingId,
        adminCode: 'badcode',
        postmasterCode: 'badcode',
      });
      if (!r.ok) lastError = r.error;
    }
    expect(lastError?.code).toBe('LOCKED_OUT');
    // 6th attempt remains LOCKED_OUT
    const sixth = await svc.verifyEmailCodes({
      onboardingId,
      adminCode: '111111',
      postmasterCode: '222222',
    });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe('LOCKED_OUT');
  });

  it('runKyb() approved → kyc_pending', async () => {
    const { deps, onboardingId } = await startAndAdvanceTo('kyc_pending');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('kyc_pending');
    expect(stored?.kybVendorRef).toBe('stub_biz_abc123');
  });

  it('runKyb() rejected (ok=false) → state.step=rejected and KYB_REJECTED error', async () => {
    const kyb = makeStubKyb({
      business: { ok: false, flags: [{ type: 'sanctions', severity: 'high' }] },
    });
    const { svc, deps, onboardingId } = await startAndAdvanceTo('kyb_pending', { kyb });
    const result = await svc.runKyb({
      onboardingId,
      legalName: 'Sketchy LLC',
      ein: '00-1234567',
      state: 'NV',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KYB_REJECTED');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('rejected');
  });

  it('runKyb() with medium-severity flag → state.step=manual_review', async () => {
    const kyb = makeStubKyb({
      business: {
        ok: true,
        flags: [{ type: 'address_mismatch', severity: 'medium' }],
      },
    });
    const { svc, deps, onboardingId } = await startAndAdvanceTo('kyb_pending', { kyb });
    const result = await svc.runKyb({
      onboardingId,
      legalName: 'Acme',
      ein: '12-3456789',
      state: 'DE',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('KYB_REVIEW');
    const stored = await deps.store.get(onboardingId);
    expect(stored?.step).toBe('manual_review');
  });

  it('full happy-path E2E: start → finalize, returns companyId + anchor tx', async () => {
    const { svc, onboardingId } = await startAndAdvanceTo('finalize_pending');
    const result = await svc.finalize({
      onboardingId,
      officerWebAuthnPublicKey: 'pk-base64-spki',
      officerCredentialId: 'cred-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.companyId).toBeTruthy();
    expect(result.value.anchorTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.value.anchorBlock).toBeGreaterThan(0n);
    expect(result.value.firstRoleCredential.role).toBe('owner');
    expect(result.value.firstRoleCredential.credentialId).toBe('cred-1');
    expect(result.value.firstRoleCredential.publicKey).toBe('pk-base64-spki');
  });
});
