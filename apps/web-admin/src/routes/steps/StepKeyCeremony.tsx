import { useState } from 'react';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LoadingDots } from '../../components/LoadingDots';
import {
  startRegistrationCeremony,
  makePlaceholderRegistrationOptions,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '../../lib/webauthn-bridge';
import { finalize } from '../../api/client';
import { ApiError } from '../../api/types';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onSetCredential: (credentialId: string) => void;
  onSetAnchor: (anchor: {
    txHash: string | null;
    blockNumber: string | null;
    root: string;
    verifiedAt: number;
  }) => void;
  onAdvance: () => void;
  onBack: () => void;
}

type Phase = 'idle' | 'creating-passkey' | 'finalizing' | 'done';

const FIXTURE_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('fixture') === 'happy-path';

export function StepKeyCeremony({ state, onSetCredential, onSetAnchor, onAdvance, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);
  const [progress, setProgress] = useState<string>('');

  async function run(): Promise<void> {
    if (!state.companyId) return;
    setApiErr(null);

    // 1. WebAuthn registration ceremony.
    //
    // NOTE on contract gap: the /finalize endpoint on main does NOT accept a
    // device attestation — WebAuthn enrollment is a separate
    // /v1/webauthn/enroll endpoint (referenced in finalize.handler.ts but
    // not yet shipped). For this slice we run the ceremony for the UX
    // beat and store the credentialId locally. The actual server-side
    // attestation upload is a follow-up ticket.
    setPhase('creating-passkey');
    let credentialId: string;
    if (FIXTURE_MODE) {
      // In fixture mode, simulate a successful ceremony.
      await new Promise((r) => setTimeout(r, 1200));
      credentialId = 'fixture-credential-' + Math.random().toString(36).slice(2, 10);
    } else {
      try {
        const options = makePlaceholderRegistrationOptions({
          rpId:            window.location.hostname,
          rpName:          'ProofLine',
          userId:          state.companyId, // company root user maps to companyId for v1 owner
          userName:        state.ownerEmail || 'owner@proofline',
          userDisplayName: state.legalName || 'Owner',
        });
        const result = await startRegistrationCeremony(options);
        credentialId = result.id;
      } catch (err) {
        if (err instanceof UserCancelled) {
          setApiErr({ code: 'USER_CANCELLED', message: 'You cancelled. Try again when ready.' });
        } else if (err instanceof DeviceUnsupported) {
          setApiErr({ code: 'DEVICE_UNSUPPORTED', message: 'This device does not support passkeys. Use a phone or laptop with Touch ID, Face ID, or Windows Hello.' });
        } else if (err instanceof WebAuthnAbortError) {
          setApiErr({ code: 'WEBAUTHN_ABORTED', message: 'The ceremony was aborted. Try again.' });
        } else {
          setApiErr({ code: 'WEBAUTHN_ERROR', message: 'Could not create the passkey. Try again.' });
        }
        setPhase('idle');
        return;
      }
    }
    onSetCredential(credentialId);

    // 2. Finalize: server creates KMS root key, signs first role credential,
    // and posts the anchor.
    setPhase('finalizing');
    setProgress('Provisioning your company’s root key in Cloud KMS…');
    try {
      // Stagger progress copy beats while the request runs.
      const beats = [
        'Signing your first role credential…',
        'Anchoring on Base Sepolia…',
      ];
      let beatIdx = 0;
      const beatInterval = setInterval(() => {
        if (beatIdx < beats.length) {
          setProgress(beats[beatIdx]!);
          beatIdx += 1;
        }
      }, 1500);

      // PFL-103: demoMode so finalize succeeds even when DNS/email/KYB/KYC
      // were demo-skipped (no prior-step records in Firestore).
      const res = await finalize({ companyId: state.companyId, demoMode: true });
      clearInterval(beatInterval);

      onSetAnchor({
        txHash:      res.anchorTxHash,
        blockNumber: res.anchorBlockNumber !== null ? String(res.anchorBlockNumber) : null,
        root:        res.anchorRoot,
        verifiedAt:  res.verifiedAt,
      });
      setPhase('done');
      onAdvance();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'Finalization failed. Try again.',
      });
      setPhase('idle');
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="key-heading">
      <header className="space-y-2">
        <h1 id="key-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          One more step — secure your account with a passkey
        </h1>
        <p className="text-base text-gray-600">
          Your device will store a cryptographic key. ProofLine never sees it.
          Future signing happens with Touch ID, Face ID, or Windows Hello — no passwords.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        {phase === 'idle' && (
          <PrimaryButton onClick={() => void run()}>
            Create passkey
          </PrimaryButton>
        )}
        {phase === 'creating-passkey' && (
          <LoadingDots label="Waiting for your device to confirm…" />
        )}
        {phase === 'finalizing' && (
          <div className="space-y-2">
            <LoadingDots label={progress || 'Finalizing…'} />
            <p className="text-xs text-gray-500">
              This usually takes 5–15 seconds. We're posting an on-chain anchor on Base Sepolia.
            </p>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-1 inline-block h-2 w-2 rounded-full bg-[#0F9D58]" />
            <p className="text-sm font-semibold text-[#0F9D58]">Anchored on-chain.</p>
          </div>
        )}
      </div>

      {phase === 'idle' && (
        <div className="flex justify-between">
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        </div>
      )}
    </section>
  );
}
