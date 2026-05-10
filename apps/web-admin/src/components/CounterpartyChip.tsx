import type { ReactNode } from 'react';
import { relativeTime } from '../lib/format';

interface Props {
  name: string;
  domain?: string;
  // PRD §8.4: verified | pending | unverified states map to the chip's
  // visual status icon.
  verified: 'verified' | 'pending' | 'unverified';
  lastActiveAt?: number | null;
  onInvite?: () => void;
  inviteLabel?: string;
  // Optional trailing slot (e.g. status badge override).
  trailing?: ReactNode;
}

export function CounterpartyChip({
  name,
  domain,
  verified,
  lastActiveAt,
  onInvite,
  inviteLabel = 'Invite',
  trailing,
}: Props) {
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-md border border-gray-200 bg-white',
        'px-3 py-2.5 text-sm',
      ].join(' ')}
    >
      <VerifiedIcon state={verified} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[#0B1F3A]">{name}</p>
        <p className="truncate text-xs text-gray-500">
          {domain ?? <span className="italic">no domain on file</span>}
          {lastActiveAt ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>active {relativeTime(lastActiveAt)}</span>
            </>
          ) : null}
        </p>
      </div>
      {trailing}
      {onInvite && verified !== 'verified' ? (
        <button
          type="button"
          onClick={onInvite}
          className={[
            'shrink-0 rounded-md border border-[#0D6EFD] bg-white px-3 py-1.5',
            'text-xs font-semibold text-[#0D6EFD]',
            'transition-colors duration-150 hover:bg-[#0D6EFD]/5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
          ].join(' ')}
        >
          {inviteLabel}
        </button>
      ) : null}
    </div>
  );
}

function VerifiedIcon({ state }: { state: 'verified' | 'pending' | 'unverified' }) {
  const tone =
    state === 'verified'
      ? { bg: 'bg-[#0F9D58]', label: 'Verified counterparty' }
      : state === 'pending'
        ? { bg: 'bg-[#B45309]', label: 'Pending counterparty' }
        : { bg: 'bg-gray-300', label: 'Unverified counterparty' };
  return (
    <span
      role="img"
      aria-label={tone.label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.bg}`}
    >
      {state === 'verified' ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-4 w-4 text-white"
          fill="currentColor"
        >
          <path d="M6.173 11.06 3.7 8.586l-1.06 1.06 3.533 3.534 7.187-7.187-1.06-1.06z" />
        </svg>
      ) : state === 'pending' ? (
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />
      ) : (
        <span aria-hidden="true" className="text-xs font-semibold text-white">?</span>
      )}
    </span>
  );
}
