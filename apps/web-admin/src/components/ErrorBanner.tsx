interface Props {
  code: string;
  message: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ code, message, onDismiss }: Props) {
  return (
    <div
      role="alert"
      className="rounded-md border border-[#D93025]/30 bg-[#D93025]/5 p-4"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-block h-2 w-2 rounded-full bg-[#D93025]" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-[#D93025]">{humanizeCode(code)}</p>
          <p className="text-sm text-gray-700">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-sm text-gray-500 hover:text-gray-700"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function humanizeCode(code: string): string {
  const map: Record<string, string> = {
    DOMAIN_ALREADY_VERIFIED:  'Domain already verified',
    ONBOARDING_STEP_INVALID:  'Step not allowed at current state',
    EMAIL_CODE_INVALID:       'Invalid verification code',
    EMAIL_CODE_EXPIRED:       'Verification code expired',
    EMAIL_CODE_NOT_ISSUED:    'No active verification code',
    KYB_FAILED:               'Business verification failed',
    KYC_INCOMPLETE:           'Identity verification incomplete',
    NOT_FOUND:                'Not found',
    BAD_REQUEST:              'Invalid request',
  };
  return map[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
