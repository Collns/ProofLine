import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

interface BaseProps {
  label: string;
  hint?: ReactNode;
  error?: string;
}

type InputProps = BaseProps & InputHTMLAttributes<HTMLInputElement> & {
  as?: 'input';
};

type SelectProps = BaseProps & SelectHTMLAttributes<HTMLSelectElement> & {
  as: 'select';
  children: ReactNode;
};

type Props = InputProps | SelectProps;

export function Field(props: Props) {
  const reactId = useId();
  const inputId = props.id ?? `field-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  const baseClass = [
    'block w-full rounded-md border bg-white px-3 py-2.5',
    'text-base text-[#1F2937] placeholder:text-gray-400',
    'shadow-sm transition-colors duration-200',
    'focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:ring-offset-0 focus:border-[#0D6EFD]',
    props.error ? 'border-[#D93025]' : 'border-gray-200',
  ].join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-[#0B1F3A]">
        {props.label}
      </label>
      {props.as === 'select' ? (
        <select
          {...(props as SelectHTMLAttributes<HTMLSelectElement>)}
          id={inputId}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy}
          className={baseClass}
        >
          {(props as SelectProps).children}
        </select>
      ) : (
        <input
          {...(props as InputHTMLAttributes<HTMLInputElement>)}
          id={inputId}
          aria-invalid={Boolean(props.error)}
          aria-describedby={describedBy}
          className={baseClass}
        />
      )}
      {props.hint && !props.error && (
        <p id={hintId} className="text-sm text-gray-500">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errorId} className="text-sm text-[#D93025]">
          {props.error}
        </p>
      )}
    </div>
  );
}
