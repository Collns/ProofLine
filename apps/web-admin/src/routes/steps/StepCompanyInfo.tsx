import { useState } from 'react';
import { Field } from '../../components/Field';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { startOnboarding } from '../../api/client';
import { ApiError } from '../../api/types';
import { DOMAIN_REGEX, EIN_REGEX, US_STATES, normalizeEin } from '../../lib/format';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onSetCompanyInfo: (info: {
    domain: string;
    legalName: string;
    ein: string;
    state: string;
    ownerEmail: string;
  }) => void;
  onStartResult: (result: {
    companyId: string;
    dnsToken: string;
    txtRecord: string;
    txtHost: string;
  }) => void;
  onBack: () => void;
  onAdvance: () => void;
}

export function StepCompanyInfo({ state, onSetCompanyInfo, onStartResult, onBack, onAdvance }: Props) {
  const [domain,     setDomain]     = useState(state.domain);
  const [legalName,  setLegalName]  = useState(state.legalName);
  const [ein,        setEin]        = useState(state.ein);
  const [usState,    setUsState]    = useState(state.state);
  const [ownerEmail, setOwnerEmail] = useState(state.ownerEmail);
  const [errors,     setErrors]     = useState<Partial<Record<'domain' | 'legalName' | 'ein' | 'state' | 'ownerEmail', string>>>({});
  const [busy,       setBusy]       = useState(false);
  const [apiErr,     setApiErr]     = useState<{ code: string; message: string } | null>(null);

  function validate(): boolean {
    const next: typeof errors = {};
    const trimmedDomain = domain.trim().toLowerCase();
    if (!DOMAIN_REGEX.test(trimmedDomain))    next.domain    = 'Enter a valid domain (e.g. acme.com).';
    if (legalName.trim().length < 3)          next.legalName = 'Legal name must be at least 3 characters.';
    if (!EIN_REGEX.test(ein.trim()))          next.ein       = 'EIN must be 9 digits, e.g. 12-3456789.';
    if (!usState)                             next.state     = 'Select a state.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail.trim()))
                                              next.ownerEmail = 'Enter a valid email address.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    setApiErr(null);
    if (!validate()) return;

    const trimmed = {
      domain:     domain.trim().toLowerCase(),
      legalName:  legalName.trim(),
      ein:        normalizeEin(ein.trim()),
      state:      usState.toUpperCase(),
      ownerEmail: ownerEmail.trim(),
    };

    onSetCompanyInfo(trimmed);
    setBusy(true);
    try {
      const result = await startOnboarding(trimmed);
      onStartResult({
        companyId: result.companyId,
        dnsToken:  result.dnsToken,
        txtRecord: result.txtRecord,
        txtHost:   result.txtHost,
      });
      onAdvance();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'Could not start onboarding. Try again in a moment.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="company-info-heading">
      <header className="space-y-2">
        <h1 id="company-info-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Tell us about your company
        </h1>
        <p className="text-base text-gray-600">
          We'll cross-check this against the state of incorporation registry in the next step.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="space-y-4"
        noValidate
      >
        <Field
          label="Sending domain"
          type="text"
          autoComplete="off"
          inputMode="url"
          placeholder="acme.com"
          value={domain}
          onChange={(e) => setDomain(e.currentTarget.value)}
          hint="The domain you'll send signed mail from."
          error={errors.domain}
        />
        <Field
          label="Legal business name"
          type="text"
          autoComplete="organization"
          placeholder="Acme Title LLC"
          value={legalName}
          onChange={(e) => setLegalName(e.currentTarget.value)}
          error={errors.legalName}
        />
        <Field
          label="EIN"
          type="text"
          autoComplete="off"
          inputMode="numeric"
          placeholder="12-3456789"
          value={ein}
          onChange={(e) => setEin(e.currentTarget.value)}
          hint="9-digit federal tax ID."
          error={errors.ein}
        />
        <Field
          as="select"
          label="State of incorporation"
          value={usState}
          onChange={(e) => setUsState(e.currentTarget.value)}
          error={errors.state}
        >
          <option value="">Select state…</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </Field>
        <Field
          label="Country"
          type="text"
          value="United States"
          disabled
          hint="Only US incorporated entities are supported in v1."
        />
        <Field
          label="Owner email"
          type="email"
          autoComplete="email"
          placeholder="you@acme.com"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.currentTarget.value)}
          hint="We'll send a verification code here in the next step."
          error={errors.ownerEmail}
        />

        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-between">
          <SecondaryButton onClick={onBack} disabled={busy}>
            Back
          </SecondaryButton>
          <PrimaryButton type="submit" loading={busy}>
            Continue → DNS verification
          </PrimaryButton>
        </div>
      </form>
    </section>
  );
}
