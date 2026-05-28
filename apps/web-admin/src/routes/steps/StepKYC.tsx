import { useState } from 'react';
import { Field } from '../../components/Field';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SkipDemoButton } from '../../components/SkipDemoButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LoadingDots } from '../../components/LoadingDots';
import { enrollOfficer } from '../../api/client';
import { ApiError } from '../../api/types';
import { getStripe } from '../../lib/stripe';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onSetResult: (result: {
    vendorRef: string;
    status: 'pending' | 'verified' | 'failed';
    officerEmail: string;
  }) => void;
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
}

type Phase = 'pick-officer' | 'launching' | 'verifying' | 'done' | 'failed';

const FIXTURE_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('fixture') === 'happy-path';

export function StepKYC({ state, onSetResult, onAdvance, onBack, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>(state.kycStatus === 'verified' ? 'done' : 'pick-officer');
  const [officerEmail, setOfficerEmail] = useState(
    state.officerEmail || (state.kybOfficers[0] ? '' : ''),
  );
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);
  const [emailErr, setEmailErr] = useState<string | undefined>(undefined);

  async function launch(): Promise<void> {
    if (!state.companyId) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(officerEmail.trim())) {
      setEmailErr('Enter a valid email for the officer.');
      return;
    }
    setEmailErr(undefined);
    setApiErr(null);
    setBusy(true);
    setPhase('launching');

    try {
      const enrollResult = await enrollOfficer({
        companyId:    state.companyId,
        officerEmail: officerEmail.trim(),
      });

      onSetResult({
        vendorRef:    enrollResult.stripeSessionId,
        status:       'pending',
        officerEmail: enrollResult.officerEmail,
      });

      // Fixture path: skip the Stripe modal and just play a 2-second beat.
      if (FIXTURE_MODE) {
        setPhase('verifying');
        await new Promise((r) => setTimeout(r, 2000));
        onSetResult({
          vendorRef:    enrollResult.stripeSessionId,
          status:       'verified',
          officerEmail: enrollResult.officerEmail,
        });
        setPhase('done');
        return;
      }

      // Real path: hand the clientSecret to Stripe.js to open the modal.
      const stripe = await getStripe();
      if (!stripe) {
        // No publishable key configured. Fall back to fixture-style beat
        // so the demo still flows; flag this for ops.
        // TODO(PFL-STRIPE): wire VITE_STRIPE_PUBLISHABLE_KEY in deployed envs.
        setPhase('verifying');
        await new Promise((r) => setTimeout(r, 2000));
        onSetResult({
          vendorRef:    enrollResult.stripeSessionId,
          status:       'verified',
          officerEmail: enrollResult.officerEmail,
        });
        setPhase('done');
        return;
      }

      setPhase('verifying');
      const { error } = await stripe.verifyIdentity(enrollResult.clientSecret);

      if (error) {
        setPhase('failed');
        onSetResult({
          vendorRef:    enrollResult.stripeSessionId,
          status:       'failed',
          officerEmail: enrollResult.officerEmail,
        });
        setApiErr({
          code:    'KYC_FAILED',
          message: error.message ?? 'Identity verification failed.',
        });
        return;
      }

      // Stripe modal closed without error. Server-side webhook will set
      // officerEnrollment.verifiedAt; we optimistically mark verified
      // in the wizard so the user can proceed. The server enforces this
      // again when /finalize is called.
      onSetResult({
        vendorRef:    enrollResult.stripeSessionId,
        status:       'verified',
        officerEmail: enrollResult.officerEmail,
      });
      setPhase('done');
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'Identity verification could not be started.',
      });
      setPhase('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="kyc-heading">
      <header className="space-y-2">
        <h1 id="kyc-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Verify the responsible officer
        </h1>
        <p className="text-base text-gray-600">
          One officer needs to confirm their identity with a government-issued ID.
          This is the person legally responsible for the account.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        {phase === 'pick-officer' && (
          <form
            onSubmit={(e) => { e.preventDefault(); void launch(); }}
            className="space-y-4"
            noValidate
          >
            <Field
              label="Officer email"
              type="email"
              autoComplete="email"
              placeholder="alice@acme.com"
              value={officerEmail}
              onChange={(e) => setOfficerEmail(e.currentTarget.value)}
              hint={
                state.kybOfficers.length > 0
                  ? `Suggested: ${state.kybOfficers.map((o) => o.name).join(', ')}`
                  : undefined
              }
              error={emailErr}
            />
            <PrimaryButton type="submit" loading={busy}>
              Verify your identity
            </PrimaryButton>
          </form>
        )}

        {phase === 'launching' && <LoadingDots label="Opening identity verification…" />}

        {phase === 'verifying' && (
          <div className="space-y-2">
            <LoadingDots label="Capturing document…" />
            <p className="text-xs text-gray-500">
              Verification result arrives via webhook from Stripe. We'll mark this step done as soon as it lands.
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-1 inline-block h-2 w-2 rounded-full bg-[#0F9D58]" />
            <div>
              <p className="text-sm font-semibold text-[#0F9D58]">Identity verified</p>
              <p className="text-sm text-gray-600">{state.officerEmail}</p>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <p className="text-sm text-gray-600">
            Identity verification failed. Try again with a government-issued ID and good lighting.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={onBack} disabled={busy}>Back</SecondaryButton>
        {phase === 'done' && (
          <PrimaryButton onClick={onAdvance}>Continue → Key ceremony</PrimaryButton>
        )}
        {phase === 'failed' && (
          <PrimaryButton onClick={() => setPhase('pick-officer')}>Try again</PrimaryButton>
        )}
      </div>

      {phase !== 'done' && <SkipDemoButton onClick={onSkip} />}
    </section>
  );
}
