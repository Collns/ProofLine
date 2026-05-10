import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function SecondaryButton({ children, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={[
        'inline-flex items-center justify-center gap-2',
        'rounded-md bg-white px-5 py-3 text-base font-semibold text-[#0B1F3A]',
        'border border-gray-200 shadow-sm transition-colors duration-200',
        'hover:bg-gray-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'min-h-[48px] w-full sm:w-auto',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
