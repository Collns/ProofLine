import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { BiometricButton } from '../components/BiometricButton';
import { ErrorScreen } from '../components/ErrorScreen';
import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '../lib/webauthn-bridge';
import {
  getCountersignContext,
  submitCountersign,
  type CountersignContext,
} from '../api/bilateral-client';

// PFL-182 — bilateral counterparty signing, opened from the portal:
//   /countersign/:docId?t=<signed link token>
//
// Runs on the sign app because counterparties' passkeys are registered for
// proofline-sign.web.app (the portal's own hostname can't use them). The
// server issues a challenge bound to the canonical payload hash, verifies the
// assertion, and derives the signer from the link token + the credential.

const RP_ID = 'proofline-sign.web.app';

type Ready = Extract<CountersignContext, { ok: true }>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'link-error'; code: string; detail: string }
  | { kind: 'ready'; context: Ready }
  | { kind: 'signing'; context: Ready }
  | { kind: 'failed'; code: string; detail: string }
  | { kind: 'signed' };

export function CountersignApprove() {
  const { docId = '' } = useParams();
  const [search] = useSearchParams();
  const token = search.get('t') ?? '';
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!docId || !token) {
        setPhase({ kind: 'link-error', code: 'BILATERAL_LINK_INVALID', detail: 'This signing link is incomplete.' });
        return;
      }
      const ctx = await getCountersignContext(docId, token);
      if (cancelled) return;
      setPhase(ctx.ok ? { kind: 'ready', context: ctx } : { kind: 'link-error', code: ctx.code, detail: ctx.detail });
    })();
    return () => { cancelled = true; };
  }, [docId, token]);

  async function sign(): Promise<void> {
    if (phase.kind !== 'ready') return;
    const { context } = phase;
    setPhase({ kind: 'signing', context });
    try {
      const assertion = await startAssertionCeremony({
        challenge: context.challenge,
        rpId: RP_ID,
        allowCredentials: [],
        userVerification: 'required',
        timeout: 60_000,
      });
      const result = await submitCountersign(docId, token, {
        challenge: context.challenge,
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
      if ('status' in result && result.status === 'BILATERAL_SIGNED') {
        setPhase({ kind: 'signed' });
      } else if ('ok' in result) {
        setPhase({ kind: 'failed', code: result.code, detail: result.detail });
      }
    } catch (e) {
      if (e instanceof UserCancelled || e instanceof WebAuthnAbortError) {
        setPhase({ kind: 'ready', context });
        return;
      }
      const detail = e instanceof DeviceUnsupported
        ? 'This device does not support passkeys. Open the link on the device you use to sign with ProofLine.'
        : (e as Error).message;
      setPhase({ kind: 'failed', code: e instanceof DeviceUnsupported ? 'DEVICE_UNSUPPORTED' : 'INTERNAL_ERROR', detail });
    }
  }

  if (phase.kind === 'link-error') {
    if (phase.code === 'ALREADY_SIGNED') {
      return <ErrorScreen title="Already signed" detail="Both parties have already signed this document. Nothing else is needed." />;
    }
    const expired = phase.code === 'BILATERAL_LINK_EXPIRED';
    return (
      <ErrorScreen
        title={expired ? 'This signing link has expired' : 'This signing link is not valid'}
        detail={phase.detail}
        code={phase.code}
      />
    );
  }
  if (phase.kind === 'failed') {
    return (
      <ErrorScreen
        title="Signature was not recorded"
        detail={phase.detail}
        code={phase.code}
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (phase.kind === 'signed') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-12 text-center space-y-3" role="status" aria-live="polite">
          <ProofLineLogo size="sm" />
          <h1 className="text-lg font-semibold text-gray-900">Document signed</h1>
          <p className="text-sm text-gray-600">Your signature is recorded. Both parties have now signed this document.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-8 space-y-5">
        <header className="flex items-center justify-between">
          <ProofLineLogo size="sm" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Counterparty signature</span>
        </header>

        {phase.kind === 'loading' && (
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center" role="status" aria-live="polite">
            <p className="text-sm text-gray-600">Checking this document with ProofLine…</p>
          </div>
        )}

        {phase.kind !== 'loading' && (
          <>
            <p className="text-sm text-gray-700">
              Review this document, then sign with your passkey to counter-sign it.
            </p>
            <dl className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white p-4 text-sm">
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Document type</dt>
                <dd className="text-gray-900">{phase.context.docType}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Document ID</dt>
                <dd className="truncate max-w-[180px] font-mono text-gray-900">{phase.context.docId}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">From</dt>
                <dd className="truncate max-w-[180px] text-gray-900">{phase.context.drafterCompanyId}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Payload hash</dt>
                <dd className="truncate max-w-[180px] font-mono text-xs text-gray-500">{phase.context.payloadHash}</dd>
              </div>
            </dl>
            <BiometricButton
              label="Sign with Touch ID"
              onClick={() => void sign()}
              loading={phase.kind === 'signing'}
            />
          </>
        )}
      </div>
    </div>
  );
}
