import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
}

export function PrimaryButton({ children, loading, disabled, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2',
        'rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white',
        'shadow-sm transition-colors duration-200',
        'hover:bg-[#0B5BD6]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'min-h-[48px] w-full sm:w-auto',
        className ?? '',
      ].join(' ')}
    >
      {loading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
      <span>{children}</span>
    </button>
  );
}
