/**
 * @file types.ts
 * @module packages/invitations
 *
 * Counterparty invitation shapes (PFL-026). The public `Invitation` shape
 * matches the contract the web-admin client already uses
 * (apps/web-admin/src/api/invitations-types.ts).
 *
 * Status state machine (PRD §6.7):
 *   sent ──accept──▶ accepted
 *     └──expiry───▶ expired   (derived from expiresAt, no write needed)
 *     └──cancel───▶ cancelled
 *     └──resend───▶ sent (new token, new expiresAt)
 */

export type InvitationStatus = "sent" | "accepted" | "expired" | "cancelled";

export interface Invitation {
  id:                   string;
  inviterCompanyId:     string;
  inviterCompanyName:   string;
  email:                string;
  status:               InvitationStatus;
  sponsoredCost:        boolean;
  message:              string | null;
  sentAt:               number;
  expiresAt:            number;
  acceptedAt:           number | null;
  cancelledAt:          number | null;
  acceptingCompanyId:   string | null;
  acceptingCompanyName: string | null;
}

/** Persisted record: the public shape plus fields that never leave the server. */
export interface InvitationRecord extends Omit<Invitation, "status"> {
  /** Stored status; "expired" is derived at read time from expiresAt. */
  status:        Exclude<InvitationStatus, "expired">;
  inviterUserId: string;
  /** sha256 (hex) of the one-time link token. The token itself is never stored. */
  tokenHash:     string;
  sendCount:     number;
  updatedAt:     number;
}

export interface Inviter {
  companyId:     string;
  companyName:   string;
  /** The inviter's own verified domain; inviting it is rejected (self_domain). */
  companyDomain: string;
  userId:        string;
}

export interface InvitationInput {
  email:          string;
  sponsoredCost?: boolean;
  message?:       string;
}

export interface BulkInvitationInput {
  emails:         string[];
  sponsoredCost?: boolean;
  message?:       string;
}

export type BulkSkipReason =
  | "invalid_email"
  | "duplicate_in_batch"
  | "already_invited"
  | "self_domain"
  | "over_limit";

/** A created invitation plus its one-time link token (for the email only). */
export interface IssuedInvitation {
  invitation: Invitation;
  token:      string;
}

export interface BulkInvitationResult {
  created: IssuedInvitation[];
  skipped: { email: string; reason: BulkSkipReason }[];
}

export interface ListInvitationsOptions {
  status?:   InvitationStatus | "all";
  page?:     number;
  pageSize?: number;
  search?:   string;
}

export interface ListInvitationsResult {
  items:    Invitation[];
  total:    number;
  page:     number;
  pageSize: number;
}

export interface NetworkStats {
  totalInvited:    number;
  verified:        number;
  pending:         number;
  expired:         number;
  cancelled:       number;
  /** accepted / (total - cancelled), 0..100 integer. */
  coveragePercent: number;
}

export type InvitationErrorCode =
  | "INVALID_EMAIL"
  | "SELF_DOMAIN"
  | "ALREADY_INVITED"
  | "OVER_LIMIT"
  | "MESSAGE_TOO_LONG"
  | "NOT_FOUND"
  | "WRONG_STATUS"
  | "EXPIRED"
  | "DOMAIN_MISMATCH";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: InvitationErrorCode; detail: string };

/** Storage port. Firestore implementation lives in apps/functions. */
export interface InvitationStore {
  put(record: InvitationRecord): Promise<void>;
  get(id: string): Promise<InvitationRecord | null>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  listByInviter(companyId: string): Promise<InvitationRecord[]>;
}
