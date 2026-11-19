import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { PayloadPreview } from '../components/PayloadPreview';
import { BiometricButton } from '../components/BiometricButton';
import { ErrorScreen } from '../components/ErrorScreen';
import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '../lib/webauthn-bridge';
import {
  getCosignContext,
  requestFreshCosignLink,
  submitCosign,
  type CosignContext,
} from '../api/cosign-client';
import { runCosignChecks, type CosignCheck } from '../lib/cosign-checks';

// PFL-136 — internal cosign approval, opened from the emailed link:
//   /cosign/:messageId?t=<signed link token>
//
// Runs on the sign app because approvers' passkeys are registered for
// proofline-sign.web.app. Flow (F-SIG-09): fetch the envelope from the
// server, recompute its hash and check the link binds to it, show the
// exact wire, and only then offer the biometric prompt.

const RP_ID = 'proofline-sign.web.app';

type Ready = Extract<CosignContext, { ok: true }>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'link-error'; code: string; detail: string }
  | { kind: 'checks-failed'; context: Ready; checks: CosignCheck[] }
  | { kind: 'ready'; context: Ready; checks: CosignCheck[] }
  | { kind: 'approving'; context: Ready; checks: CosignCheck[] }
  | { kind: 'failed'; code: string; detail: string }
  | { kind: 'approved' };

export function CosignApprove() {
  const { messageId = '' } = useParams();
  const [search] = useSearchParams();
  const token = search.get('t') ?? '';
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [refresh, setRefresh] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!messageId || !token) {
        setPhase({ kind: 'link-error', code: 'COSIGN_LINK_INVALID', detail: 'This approval link is incomplete.' });
        return;
      }
      const ctx = await getCosignContext(messageId, token);
      if (cancelled) return;
      if (!ctx.ok) {
        setPhase({ kind: 'link-error', code: ctx.code, detail: ctx.detail });
        return;
      }
      const checks = await runCosignChecks({
        messageId, token, payload: ctx.payload, payloadHash: ctx.payloadHash, signerCompanyId: ctx.signer.companyId,
      });
      if (cancelled) return;
      setPhase({ kind: checks.every((c) => c.passed) ? 'ready' : 'checks-failed', context: ctx, checks });
    })();
    return () => { cancelled = true; };
  }, [messageId, token]);

  async function approve(): Promise<void> {
    if (phase.kind !== 'ready') return;
    const { context, checks } = phase;
    setPhase({ kind: 'approving', context, checks });
    try {
      const assertion = await startAssertionCeremony({
        challenge: context.cosignChallenge,
        rpId: RP_ID,
        allowCredentials: [],
        userVerification: 'required',
        timeout: 60_000,
      });
      const result = await submitCosign(messageId, token, {
        challenge: context.cosignChallenge,
        assertion: {
          id: assertion.id,
          response: {
            clientDataJSON: assertion.response.clientDataJSON,
            authenticatorData: assertion.response.authenticatorData,
            signature: assertion.response.signature,
            ...(assertion.response.userHandle ? { userHandle: assertion.response.userHandle } : {}),
          },
        },
      });
      setPhase(result.ok ? { kind: 'approved' } : { kind: 'failed', code: result.code, detail: result.detail });
    } catch (e) {
      if (e instanceof UserCancelled || e instanceof WebAuthnAbortError) {
        setPhase({ kind: 'ready', context, checks });
        return;
      }
      const detail = e instanceof DeviceUnsupported
        ? 'This device does not support passkeys. Open the link on the device you use to sign with ProofLine.'
        : (e as Error).message;
      setPhase({ kind: 'failed', code: e instanceof DeviceUnsupported ? 'DEVICE_UNSUPPORTED' : 'INTERNAL_ERROR', detail });
    }
  }

  async function askForFreshLink(): Promise<void> {
    setRefresh('sending');
    const r = await requestFreshCosignLink(messageId, token);
    setRefresh(r.ok ? 'sent' : 'error');
  }

  if (phase.kind === 'link-error') {
    const expired = phase.code === 'COSIGN_LINK_EXPIRED';
    if (phase.code === 'ALREADY_COSIGNED') {
      return <ErrorScreen title="Already approved" detail="This wire has already been cosigned. Nothing else is needed." />;
    }
    return (
      <ErrorScreen
        title={expired ? 'This approval link has expired' : 'This approval link is not valid'}
        detail={
          refresh === 'sent'
            ? 'If you are an approver for this wire, a new link is on its way to your inbox.'
            : refresh === 'error'
              ? 'A new link could not be requested. Ask the sender to sign the wire again.'
              : phase.detail
        }
        code={phase.code}
        {...(expired && refresh === 'idle'
          ? { onRetry: () => void askForFreshLink(), retryLabel: 'Email me a new link' }
          : {})}
      />
    );
  }
  if (phase.kind === 'failed') {
    return (
      <ErrorScreen
        title="Approval was not recorded"
        detail={phase.detail}
        code={phase.code}
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (phase.kind === 'approved') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-12 text-center space-y-3" role="status" aria-live="polite">
          <ProofLineLogo size="sm" />
          <h1 className="text-lg font-semibold text-gray-900">Wire approved</h1>
          <p className="text-sm text-gray-600">Your cosignature is recorded. The sender can now send the wire.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-8 space-y-5">
        <header className="flex items-center justify-between">
          <ProofLineLogo size="sm" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cosign request</span>
        </header>

        {phase.kind === 'loading' && (
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center" role="status" aria-live="polite">
            <p className="text-sm text-gray-600">Checking this request with ProofLine…</p>
          </div>
        )}

        {phase.kind !== 'loading' && (
          <>
            <p className="text-sm text-gray-700">
              <span className="font-medium">{phase.context.signer.userDisplayName}</span> at{' '}
              <span className="font-medium">{phase.context.signer.companyLegalName}</span> signed this wire and needs your approval.
            </p>
            <ul className="space-y-1 rounded-md border border-gray-200 bg-white p-4 text-sm" aria-label="Checks">
              {phase.checks.map((c) => (
                <li key={c.id} className={c.passed ? 'text-[#0F9D58]' : 'text-[#B91C1C]'}>
                  {c.passed ? '✓' : '✗'} {c.label}
                </li>
              ))}
            </ul>
            <PayloadPreview payload={phase.context.payload} payloadHash={phase.context.payloadHash} />
            {phase.kind === 'checks-failed' ? (
              <p className="text-sm font-medium text-[#B91C1C]" role="alert">
                Do not approve. Something about this request doesn't match. Contact the sender by phone.
              </p>
            ) : (
              <BiometricButton
                label="Approve with Touch ID"
                onClick={() => void approve()}
                loading={phase.kind === 'approving'}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
