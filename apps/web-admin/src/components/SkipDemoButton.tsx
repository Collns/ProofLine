interface Props {
  onClick: () => void;
  label?: string;
}

// Subtle "skip this external-verification step" affordance, shown only so
// the demo flow can proceed without real DNS / Middesk KYB / Stripe KYC.
// Deliberately low-prominence (gray, small) so it doesn't read as a primary
// action in a real onboarding.
export function SkipDemoButton({ onClick, label = 'Skip for demo →' }: Props) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
        style={{
          background: 'none',
          border: 'none',
          color: '#6B7280',
          fontSize: '12px',
          cursor: 'pointer',
          marginTop: '8px',
        }}
      >
        {label}
      </button>
    </div>
  );
}
