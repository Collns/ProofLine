import { useState } from 'react';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LoadingDots } from '../../components/LoadingDots';
import { runKyb } from '../../api/client';
import { ApiError } from '../../api/types';
import { truncateHash } from '../../lib/format';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onSetResult: (result: {
    vendorRef: string;
    status: 'approved' | 'flagged';
    officers: { name: string; role: string }[];
  }) => void;
  onAdvance: () => void;
  onBack: () => void;
}

export function StepKYB({ state, onSetResult, onAdvance, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);
  const hasResult = state.kybVendorRef !== null;

  async function run(): Promise<void> {
    if (!state.companyId) return;
    setApiErr(null);
    setBusy(true);
    try {
      const res = await runKyb({ companyId: state.companyId });
      // The API returns binary pass on 200 / 422 KYB_FAILED on rejection.
      // Manual-review flagged variant is not modeled server-side today (per
      // F-ON-07 it lives in the manual review queue, separate ticket).
      onSetResult({
        vendorRef: res.vendorRef,
        status:    'approved',
        officers:  res.officers,
      });
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'KYB lookup failed. Try again or contact support.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="kyb-heading">
      <header className="space-y-2">
        <h1 id="kyb-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Business verification
        </h1>
        <p className="text-base text-gray-600">
          We'll look up <strong>{state.legalName || 'your company'}</strong> in the
          state of incorporation registry. This usually takes 5–30 seconds.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        {!hasResult ? (
          busy ? (
            <LoadingDots
              label={`Looking up ${state.legalName} in ${state.state} registry…`}
            />
          ) : (
            <PrimaryButton onClick={() => void run()} loading={busy}>
              Run business verification
            </PrimaryButton>
          )
        ) : (
          <KybResult
            vendorRef={state.kybVendorRef!}
            officers={state.kybOfficers}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={onBack} disabled={busy}>Back</SecondaryButton>
        {hasResult && (
          <PrimaryButton onClick={onAdvance}>Continue → Officer identity</PrimaryButton>
        )}
      </div>
    </section>
  );
}

function KybResult({ vendorRef, officers }: {
  vendorRef: string;
  officers: { name: string; role: string }[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-1 inline-block h-2 w-2 rounded-full bg-[#0F9D58]" />
        <div>
          <p className="text-sm font-semibold text-[#0F9D58]">Verified</p>
          <p className="text-sm text-gray-600">
            Middesk reference: <code className="font-mono">{truncateHash(vendorRef, 8)}</code>
          </p>
        </div>
      </div>

      {officers.length > 0 && (
        <div>
          <p className="text-sm font-medium text-[#0B1F3A]">Officers on record</p>
          <ul className="mt-2 space-y-1.5">
            {officers.map((o, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="font-medium text-[#1F2937]">{o.name}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-600">{o.role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            One of these officers will need to complete identity verification in the next step.
          </p>
        </div>
      )}
    </div>
  );
}
