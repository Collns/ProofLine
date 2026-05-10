import type { InvitationStatus } from '../api/invitations-types';

interface Props {
  status: InvitationStatus;
  // PRD §7.10: invitee onboards via streamlined flow → "verified" reads
  // better than "accepted" in the dashboard, so we pass an explicit
  // accepted-label prop for surfaces that want to surface that nuance.
  acceptedLabel?: 'Verified' | 'Accepted';
  className?: string;
}

const TONE: Record<
  InvitationStatus,
  { label: string; bg: string; ring: string; text: string; dot: string }
> = {
  sent: {
    label: 'Sent',
    bg:    'bg-[#0D6EFD]/10',
    ring:  'ring-[#0D6EFD]/30',
    text:  'text-[#0D6EFD]',
    dot:   'bg-[#0D6EFD]',
  },
  accepted: {
    label: 'Verified',
    bg:    'bg-[#0F9D58]/10',
    ring:  'ring-[#0F9D58]/30',
    text:  'text-[#0F9D58]',
    dot:   'bg-[#0F9D58]',
  },
  expired: {
    label: 'Expired',
    bg:    'bg-[#B45309]/10',
    ring:  'ring-[#B45309]/30',
    text:  'text-[#B45309]',
    dot:   'bg-[#B45309]',
  },
  cancelled: {
    label: 'Cancelled',
    bg:    'bg-gray-100',
    ring:  'ring-gray-300',
    text:  'text-gray-600',
    dot:   'bg-gray-400',
  },
};

export function InvitationStatusBadge({ status, acceptedLabel, className }: Props) {
  const tone = TONE[status];
  const label =
    status === 'accepted' && acceptedLabel ? acceptedLabel : tone.label;
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        tone.bg,
        tone.ring,
        tone.text,
        className ?? '',
      ].join(' ')}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}
