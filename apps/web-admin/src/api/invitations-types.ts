// Counterparty invitation API shapes for the web-admin client.
//
// Aligned with TDD §4.9 InvitationProvider and PRD §6.7 F-INV-01..09.
// The @proofline/invitations workspace package is currently a stub
// (export {} only), so types are mirrored here until a server contract
// is published in apps/functions/.
//
// Status state machine (PRD §6.7, §7.10):
//   sent  ──accept──▶ accepted
//      └──30d─────▶ expired
//      └──cancel──▶ cancelled
//      └──resend──▶ sent (new expiresAt)

export type InvitationStatus = 'sent' | 'accepted' | 'expired' | 'cancelled';

export interface Invitation {
  id: string;
  inviterCompanyId: string;
  inviterCompanyName: string;
  email: string;
  status: InvitationStatus;
  sponsoredCost: boolean;
  message: string | null;
  sentAt: number;          // epoch ms
  expiresAt: number;       // epoch ms (sentAt + 30d for v1)
  acceptedAt: number | null;
  cancelledAt: number | null;
  acceptingCompanyId: string | null;
  acceptingCompanyName: string | null;
  // Optional engagement signals — server may omit if not tracked.
  emailOpenedAt?: number | null;
  onboardingStartedAt?: number | null;
}

export interface InvitationInput {
  email: string;
  sponsoredCost?: boolean;
  message?: string;
}

export interface BulkInvitationInput {
  emails: string[];
  sponsoredCost?: boolean;
  message?: string;
}

export interface BulkInvitationResult {
  created: Invitation[];
  skipped: { email: string; reason: BulkSkipReason }[];
}

export type BulkSkipReason =
  | 'invalid_email'
  | 'duplicate_in_batch'
  | 'already_invited'
  | 'self_domain'
  | 'over_limit';

export interface ListInvitationsOptions {
  status?: InvitationStatus | 'all';
  page?: number;       // 1-indexed
  pageSize?: number;   // default 25
  search?: string;     // matches email or counterparty name
}

export interface ListInvitationsResult {
  items: Invitation[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NetworkStats {
  totalInvited: number;
  verified: number;
  pending: number;
  expired: number;
  cancelled: number;
  coveragePercent: number;     // 0..100, integer
}