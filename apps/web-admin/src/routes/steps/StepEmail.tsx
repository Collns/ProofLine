import { useState } from 'react';
import { Field } from '../../components/Field';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SkipDemoButton } from '../../components/SkipDemoButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { verifyEmail, verifyEmailCode } from '../../api/client';
import { ApiError } from '../../api/types';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onMarkVerified: (at: number) => void;
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
}

// Note on spec divergence: the spec asks for two codes (admin@ + postmaster@)
// but the API on main sends a SINGLE 6-digit code to ownerEmail. We follow
// the API. Caller flagged this in the discovery report — see README.

export function StepEmail({ state, onMarkVerified, onAdvance, onBack, onSkip }: Props) {
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);
  const [codeErr, setCodeErr] = useState<string | undefined>(undefined);

  async function send(): Promise<void> {
    if (!state.companyId) return;
    setApiErr(null);
    setBusy(true);
    try {
      const res = await verifyEmail({ companyId: state.companyId });
      setSent(res.sent);
      setSentTo(res.to);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'Could not send the verification code. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!state.companyId) return;
    setCodeErr(undefined);
    setApiErr(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeErr('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      await verifyEmailCode({ companyId: state.companyId, code: code.trim() });
      onMarkVerified(Date.now());
      onAdvance();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.code === 'EMAIL_CODE_INVALID' || e?.code === 'EMAIL_CODE_EXPIRED') {
        setCodeErr(e.message);
      } else {
        setApiErr({
          code:    e?.code ?? 'UNKNOWN',
          message: e?.message ?? 'Code verification failed. Try again.',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="email-heading">
      <header className="space-y-2">
        <h1 id="email-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Verify your email
        </h1>
        <p className="text-base text-gray-600">
          We'll send a 6-digit code to {state.ownerEmail || 'your owner email'}.
          Enter it here to confirm you can receive mail at that address.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        {!sent ? (
          <PrimaryButton onClick={() => void send()} loading={busy}>
            Send code
          </PrimaryButton>
        ) : (
          <>
            <p className="text-sm text-[#0F9D58]">
              Code sent to <span className="font-mono">{sentTo}</span> · expires in 10 minutes.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); void submit(); }}
              className="space-y-4"
              noValidate
            >
              <Field
                label="6-digit code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
                error={codeErr}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => void send()}
                  className="text-sm font-medium text-[#0D6EFD] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 self-start rounded"
                  disabled={busy}
                >
                  Didn't receive it? Resend code
                </button>
                <PrimaryButton type="submit" loading={busy}>
                  Verify code
                </PrimaryButton>
              </div>
            </form>
          </>
        )}
      </div>

      <div className="flex justify-between">
        <SecondaryButton onClick={onBack} disabled={busy}>Back</SecondaryButton>
      </div>

      <SkipDemoButton onClick={onSkip} />
    </section>
  );
}
