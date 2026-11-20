import type { SigningScreening } from '@proofline/types';

// PFL-028 — advisory wire-memo screening shown before the biometric prompt.
// Purely a warning: signing is never blocked. `unavailable` means the
// screener could not run (not a clean result), which we say plainly so a
// clean-looking screen is never mistaken for a safety guarantee.

const FLAG_LABEL: Record<string, string> = {
  urgency: 'Pressure to act urgently',
  secrecy: 'Asked to keep it quiet or skip a call-back',
  executive_impersonation: 'Claims to act for an executive',
  procedure_bypass: 'Asks to skip normal approval',
  payment_change: 'New or changed bank / account details',
  unusual_request: 'Unusual destination (gift cards, crypto, overseas)',
};

function label(type: string): string {
  return FLAG_LABEL[type] ?? type.replace(/_/g, ' ');
}

export function ScreeningWarning({ screening }: { screening?: SigningScreening }) {
  if (!screening) return null;

  if (screening.status === 'unavailable') {
    return (
      <div
        role="note"
        className="rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700"
      >
        Automated wire-fraud screening could not run for this message. This is
        not a clean result — review the wire details yourself before signing.
      </div>
    );
  }

  if (screening.flags.length === 0) return null;

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-[#B45309]/40 bg-[#B45309]/5 p-3 text-sm text-[#7C2D12]"
    >
      <p className="font-semibold">
        This wire shows signs often seen in payment-redirection fraud. Confirm it
        with the recipient on a trusted phone number before you sign.
      </p>
      {screening.summary && <p>{screening.summary}</p>}
      <ul className="list-disc space-y-1 pl-5">
        {screening.flags.map((f, i) => (
          <li key={`${f.type}-${i}`}>
            {label(f.type)}
            {f.evidence ? <span className="text-[#92400E]"> — “{f.evidence}”</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
