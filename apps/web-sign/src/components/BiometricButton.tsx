import type { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  label?: string;
}

export function BiometricButton({
  loading,
  disabled,
  label = 'Sign with Touch ID',
  className,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-3',
        'rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white',
        'shadow-sm transition-colors duration-200',
        'hover:bg-[#0B5BD6]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'min-h-[52px] w-full',
        className ?? '',
      ].join(' ')}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
        />
      ) : (
        <FingerprintIcon />
      )}
      <span>{loading ? 'Waiting for your device…' : label}</span>
    </button>
  );
}

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M12 2c-3.3 0-6 2.5-6 5.7M5 12c0-1.5.4-2.9 1.1-4M19 12c0-3.9-3.1-7-7-7M9 16c0-1.7 1.3-3 3-3s3 1.3 3 3M12 22v-7M7 22c-.5-2-.7-4-.5-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
