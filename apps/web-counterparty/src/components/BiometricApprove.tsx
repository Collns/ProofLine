import { formatUSD, formatAccountMasked } from '../lib/format';

interface BiometricApproveProps {
  amount: number;            // cents
  recipientAccount: string;
  disabled: boolean;
  busy?: boolean;
  onClick: () => void;
}

export function BiometricApprove({
  amount,
  recipientAccount,
  disabled,
  busy,
  onClick,
}: BiometricApproveProps) {
  const accountLabel = formatAccountMasked(recipientAccount);
  const label = busy
    ? 'Waiting for biometric…'
    : `Approve ${formatUSD(amount)} to ${accountLabel} with Touch ID`;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white/95 backdrop-blur-sm sm:static sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none">
      <div className="mx-auto max-w-2xl px-4 py-3 sm:px-0 sm:py-0">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || busy}
          aria-disabled={disabled || busy}
          className="w-full rounded-xl bg-blue-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
        >
          {label}
        </button>
        {disabled && !busy ? (
          <p className="mt-2 text-center text-xs text-gray-500 sm:text-left">
            Biometric approval unlocks once all verification steps pass.
          </p>
        ) : null}
      </div>
    </div>
  );
}
