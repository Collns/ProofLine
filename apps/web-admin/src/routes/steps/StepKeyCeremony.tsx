import { useState } from 'react';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LoadingDots } from '../../components/LoadingDots';
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

type Phase = 'idle' | 'finalizing' | 'done';

// Finalize creates the company root key in Cloud KMS, issues the owner's
// role credential and anchors the registry root. The server only allows it
// once DNS, email, KYB and officer identity are all verified (PFL-167).
//
// The owner's signing passkey is NOT created here: it is registered on the
// owner's own device, with a server-issued challenge, when they connect the
// ProofLine extension in the next step.
export function StepKeyCeremony({ state, onSetCredential, onSetAnchor, onAdvance, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);
  const [progress, setProgress] = useState<string>('');

  async function run(): Promise<void> {
    if (!state.companyId) return;
    setApiErr(null);

    setPhase('finalizing');
    setProgress('Provisioning your company’s root key in Cloud KMS…');
    const beats = [
      'Signing your owner role credential…',
      'Anchoring your company record on-chain…',
    ];
    let beatIdx = 0;
    const beatInterval = setInterval(() => {
      if (beatIdx < beats.length) {
        setProgress(beats[beatIdx]!);
        beatIdx += 1;
      }
    }, 1500);

    try {
      const res = await finalize({ companyId: state.companyId });
      onSetCredential(res.credentialId);
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
    } finally {
      clearInterval(beatInterval);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="key-heading">
      <header className="space-y-2">
        <h1 id="key-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Create your company keys
        </h1>
        <p className="text-base text-gray-600">
          We’ll create your company’s root key and your owner credential. Your personal
          signing passkey is created on your own device when you connect the ProofLine
          extension in the next step. ProofLine never sees it.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        {phase === 'idle' && (
          <PrimaryButton onClick={() => void run()}>
            Create company keys
          </PrimaryButton>
        )}
        {phase === 'finalizing' && (
          <div className="space-y-2">
            <LoadingDots label={progress || 'Finalizing…'} />
            <p className="text-xs text-gray-500">
              This usually takes 5–15 seconds while we post an on-chain anchor.
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
