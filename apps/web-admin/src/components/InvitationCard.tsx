import { Link } from 'react-router-dom';
import type { Invitation } from '../api/invitations-types';
import { InvitationStatusBadge } from './InvitationStatusBadge';
import { relativeTime } from '../lib/format';

interface Props {
  invitation: Invitation;
  // Show the small "verified"/"sent" relative timestamp inline. Defaults true.
  showTimestamp?: boolean;
}

export function InvitationCard({ invitation, showTimestamp = true }: Props) {
  const ts =
    invitation.status === 'accepted' && invitation.acceptedAt
      ? `verified ${relativeTime(invitation.acceptedAt)}`
      : invitation.status === 'expired'
        ? `expired ${relativeTime(invitation.expiresAt)}`
        : invitation.status === 'cancelled' && invitation.cancelledAt
          ? `cancelled ${relativeTime(invitation.cancelledAt)}`
          : `sent ${relativeTime(invitation.sentAt)}`;

  return (
    <Link
      to={`/invitations/${invitation.id}`}
      className={[
        'group flex items-center justify-between gap-3',
        'rounded-md border border-gray-200 bg-white px-4 py-3',
        'transition-colors duration-150',
        'hover:border-[#0D6EFD] hover:bg-gray-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium text-[#0B1F3A]">
          {invitation.acceptingCompanyName ?? invitation.email}
        </p>
        <p className="truncate text-xs text-gray-500">
          {invitation.acceptingCompanyName ? invitation.email : domainOf(invitation.email)}
          {showTimestamp ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>{ts}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <InvitationStatusBadge status={invitation.status} />
        <span
          aria-hidden="true"
          className="text-gray-400 transition-colors duration-150 group-hover:text-[#0D6EFD]"
        >
          →
        </span>
      </div>
    </Link>
  );
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}
