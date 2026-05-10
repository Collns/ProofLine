import type { VerificationResponse } from '../api/types';

type State = VerificationResponse['state'];

const STATE_CONFIG: Record<
  State,
  { label: string; bg: string; text: string; border: string; icon: React.ReactNode }
> = {
  verified: {
    label: 'Verified',
    bg: 'bg-[#0F9D58]',
    text: 'text-white',
    border: 'border-[#0F9D58]',
    icon: <CheckIcon />,
  },
  bilateral: {
    label: 'Bilaterally Signed',
    bg: 'bg-[#047857]',
    text: 'text-white',
    border: 'border-[#047857]',
    icon: <CheckDoubleIcon />,
  },
  suspected_spoof: {
    label: 'Suspected Spoof',
    bg: 'bg-[#D93025]',
    text: 'text-white',
    border: 'border-[#D93025]',
    icon: <AlertIcon />,
  },
  rejected: {
    label: 'Verification Failed',
    bg: 'bg-[#D93025]',
    text: 'text-white',
    border: 'border-[#D93025]',
    icon: <XIcon />,
  },
  unverified_sender: {
    label: 'Sender Not Enrolled',
    bg: 'bg-gray-200',
    text: 'text-gray-700',
    border: 'border-gray-300',
    icon: <QuestionIcon />,
  },
};

interface Props {
  state: State;
  size?: 'sm' | 'md' | 'lg';
}

export function VerifyBadge({ state, size = 'md' }: Props) {
  const config = STATE_CONFIG[state];
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-3 py-1 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2',
  }[size];

  return (
    <span
      role="status"
      aria-label={`Verification status: ${config.label}`}
      className={`inline-flex items-center rounded-full font-semibold ${config.bg} ${config.text} ${sizeClasses}`}
    >
      <span aria-hidden="true" className="shrink-0">
        {config.icon}
      </span>
      {config.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckDoubleIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d="M1.5 7L4.5 10L10.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 7L8.5 10L14.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2L13 12H1L7 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 6V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="10.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 5.5C5.5 4.67 6.17 4 7 4C7.83 4 8.5 4.67 8.5 5.5C8.5 6.33 7 7 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="10" r="0.75" fill="currentColor" />
    </svg>
  );
}
