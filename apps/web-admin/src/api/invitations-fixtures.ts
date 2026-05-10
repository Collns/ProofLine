import type {
  Invitation,
  InvitationStatus,
  ListInvitationsOptions,
  ListInvitationsResult,
  NetworkStats,
} from './invitations-types';

// Synthetic invitations for fixture-mode demos. Mirrors the company
// established in apps/web-admin/src/api/fixtures.ts (Acme Title).
//
// Distribution: 12 accepted, 14 sent (pending), 2 expired = 28 total.

const INVITER_ID   = 'co_fixture_acme_title';
const INVITER_NAME = 'Acme Title';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function inv(
  id: string,
  email: string,
  status: InvitationStatus,
  sentDaysAgo: number,
  opts: {
    sponsoredCost?: boolean;
    message?: string | null;
    acceptedDaysAgo?: number;
    acceptingCompanyName?: string;
    cancelledDaysAgo?: number;
    onboardingStartedDaysAgo?: number;
    emailOpenedDaysAgo?: number;
  } = {},
): Invitation {
  const sentAt = NOW - sentDaysAgo * DAY;
  return {
    id,
    inviterCompanyId:   INVITER_ID,
    inviterCompanyName: INVITER_NAME,
    email,
    status,
    sponsoredCost:      opts.sponsoredCost ?? false,
    message:            opts.message ?? null,
    sentAt,
    expiresAt:          sentAt + 30 * DAY,
    acceptedAt:
      status === 'accepted' && opts.acceptedDaysAgo !== undefined
        ? NOW - opts.acceptedDaysAgo * DAY
        : null,
    acceptingCompanyId:
      status === 'accepted' ? `co_fixture_${id}` : null,
    acceptingCompanyName:
      status === 'accepted' ? opts.acceptingCompanyName ?? null : null,
    cancelledAt:
      status === 'cancelled' && opts.cancelledDaysAgo !== undefined
        ? NOW - opts.cancelledDaysAgo * DAY
        : null,
    emailOpenedAt:
      opts.emailOpenedDaysAgo !== undefined
        ? NOW - opts.emailOpenedDaysAgo * DAY
        : null,
    onboardingStartedAt:
      opts.onboardingStartedDaysAgo !== undefined
        ? NOW - opts.onboardingStartedDaysAgo * DAY
        : null,
  };
}

// 12 accepted (verified counterparties)
const accepted: Invitation[] = [
  inv('inv_001', 'closing@titlepro-escrow.com',     'accepted', 21, { acceptedDaysAgo: 19, acceptingCompanyName: 'TitlePro Escrow', emailOpenedDaysAgo: 21, onboardingStartedDaysAgo: 20 }),
  inv('inv_002', 'wires@firstmidwest-bank.com',     'accepted', 18, { acceptedDaysAgo: 17, acceptingCompanyName: 'First Midwest Bank', sponsoredCost: true, emailOpenedDaysAgo: 18, onboardingStartedDaysAgo: 17 }),
  inv('inv_003', 'ops@horizon-title.com',           'accepted', 16, { acceptedDaysAgo: 14, acceptingCompanyName: 'Horizon Title Co', emailOpenedDaysAgo: 16 }),
  inv('inv_004', 'compliance@scotia-trust.com',     'accepted', 15, { acceptedDaysAgo: 13, acceptingCompanyName: 'Scotia Trust', emailOpenedDaysAgo: 15, onboardingStartedDaysAgo: 14 }),
  inv('inv_005', 'admin@bayshore-escrow.com',       'accepted', 13, { acceptedDaysAgo: 12, acceptingCompanyName: 'Bayshore Escrow', sponsoredCost: true }),
  inv('inv_006', 'wires@granite-state-savings.com', 'accepted', 12, { acceptedDaysAgo: 9,  acceptingCompanyName: 'Granite State Savings', emailOpenedDaysAgo: 12 }),
  inv('inv_007', 'team@summit-closing.com',         'accepted', 10, { acceptedDaysAgo: 9,  acceptingCompanyName: 'Summit Closing Group', emailOpenedDaysAgo: 10, onboardingStartedDaysAgo: 9 }),
  inv('inv_008', 'closings@bluefin-title.com',      'accepted', 9,  { acceptedDaysAgo: 7,  acceptingCompanyName: 'Bluefin Title Services' }),
  inv('inv_009', 'wires@coastal-savings.com',       'accepted', 7,  { acceptedDaysAgo: 6,  acceptingCompanyName: 'Coastal Savings Bank', emailOpenedDaysAgo: 7 }),
  inv('inv_010', 'closings@anchor-escrow.com',      'accepted', 6,  { acceptedDaysAgo: 5,  acceptingCompanyName: 'Anchor Escrow Partners', sponsoredCost: true }),
  inv('inv_011', 'ops@cedarvalley-title.com',       'accepted', 5,  { acceptedDaysAgo: 3,  acceptingCompanyName: 'Cedar Valley Title', emailOpenedDaysAgo: 5 }),
  inv('inv_012', 'admin@northstar-closing.com',     'accepted', 3,  { acceptedDaysAgo: 1,  acceptingCompanyName: 'Northstar Closing Services', emailOpenedDaysAgo: 3, onboardingStartedDaysAgo: 2 }),
];

// 14 pending (sent, not yet accepted, not yet expired)
const pending: Invitation[] = [
  inv('inv_013', 'wires@scotiabank.com',            'sent', 2,  { emailOpenedDaysAgo: 1, onboardingStartedDaysAgo: 1, message: 'Hey — we route closing wires through ProofLine now. Sign up so we can transact securely.' }),
  inv('inv_014', 'closings@meridian-title.com',     'sent', 2,  { emailOpenedDaysAgo: 2 }),
  inv('inv_015', 'admin@harbor-escrow.com',         'sent', 3,  { sponsoredCost: true }),
  inv('inv_016', 'compliance@piedmont-trust.com',   'sent', 4,  { emailOpenedDaysAgo: 3 }),
  inv('inv_017', 'wires@redwood-savings.com',       'sent', 5),
  inv('inv_018', 'ops@beacon-title.com',            'sent', 6,  { emailOpenedDaysAgo: 4 }),
  inv('inv_019', 'team@evergreen-escrow.com',       'sent', 7,  { sponsoredCost: true, message: 'Quick note — closing is faster on ProofLine. Set-up takes ~10 minutes and we sponsor the cost.' }),
  inv('inv_020', 'admin@hilltop-closing.com',       'sent', 9),
  inv('inv_021', 'wires@silvercreek-bank.com',      'sent', 11, { emailOpenedDaysAgo: 9 }),
  inv('inv_022', 'closings@oakwood-title.com',      'sent', 14),
  inv('inv_023', 'ops@brightline-escrow.com',       'sent', 17, { emailOpenedDaysAgo: 14, onboardingStartedDaysAgo: 12 }),
  inv('inv_024', 'wires@maple-financial.com',       'sent', 20),
  inv('inv_025', 'admin@stonebridge-title.com',     'sent', 23, { emailOpenedDaysAgo: 20 }),
  inv('inv_026', 'compliance@harbor-banking.com',   'sent', 27),
];

// 2 expired (>30d sent, no acceptance)
const expired: Invitation[] = [
  inv('inv_027', 'closings@oldmill-title.com',  'expired', 33, { emailOpenedDaysAgo: 32 }),
  inv('inv_028', 'ops@midwest-closing.com',     'expired', 41),
];

const ALL_INVITATIONS: Invitation[] = [...accepted, ...pending, ...expired]
  // Newest sent first.
  .sort((a, b) => b.sentAt - a.sentAt);

// Lazy-loaded mutable copy so the fixture client can mutate it during a
// session (creating, resending, cancelling) without polluting the source
// of truth across module reloads.
let mutableStore: Invitation[] | null = null;

export function getFixtureStore(): Invitation[] {
  if (mutableStore === null) {
    mutableStore = ALL_INVITATIONS.map((i) => ({ ...i }));
  }
  return mutableStore;
}

export function resetFixtureStore(): void {
  mutableStore = ALL_INVITATIONS.map((i) => ({ ...i }));
}

// Server-style filter + paginate for fixture mode.
export function fixtureListInvitations(
  opts: ListInvitationsOptions = {},
): ListInvitationsResult {
  const status   = opts.status ?? 'all';
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 25;
  const search   = (opts.search ?? '').trim().toLowerCase();

  let items = getFixtureStore().slice();
  if (status !== 'all') {
    items = items.filter((i) => i.status === status);
  }
  if (search) {
    items = items.filter(
      (i) =>
        i.email.toLowerCase().includes(search) ||
        (i.acceptingCompanyName ?? '').toLowerCase().includes(search),
    );
  }
  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return { items: paged, total, page, pageSize };
}

export function fixtureGetInvitation(id: string): Invitation | null {
  return getFixtureStore().find((i) => i.id === id) ?? null;
}

export function fixtureNetworkStats(): NetworkStats {
  const all = getFixtureStore();
  const totalInvited = all.length;
  const verified  = all.filter((i) => i.status === 'accepted').length;
  const pendingN  = all.filter((i) => i.status === 'sent').length;
  const expiredN  = all.filter((i) => i.status === 'expired').length;
  const cancelled = all.filter((i) => i.status === 'cancelled').length;
  const coveragePercent =
    totalInvited === 0 ? 0 : Math.round((verified / totalInvited) * 100);
  return {
    totalInvited,
    verified,
    pending:   pendingN,
    expired:   expiredN,
    cancelled,
    coveragePercent,
  };
}

let createdCounter = 0;

export function fixtureCreateInvitation(
  email: string,
  opts: { sponsoredCost?: boolean; message?: string },
): Invitation {
  const id = `inv_new_${(++createdCounter).toString().padStart(3, '0')}`;
  const created = inv(id, email, 'sent', 0, {
    sponsoredCost: opts.sponsoredCost,
    message:       opts.message ?? null,
  });
  getFixtureStore().unshift(created);
  return created;
}

export function fixtureCancelInvitation(id: string): void {
  const target = getFixtureStore().find((i) => i.id === id);
  if (target && target.status === 'sent') {
    target.status      = 'cancelled';
    target.cancelledAt = Date.now();
  }
}

export function fixtureResendInvitation(id: string): Invitation | null {
  const target = getFixtureStore().find((i) => i.id === id);
  if (!target) return null;
  // Reset clock — sent now, fresh 30-day window.
  target.status      = 'sent';
  target.sentAt      = Date.now();
  target.expiresAt   = Date.now() + 30 * DAY;
  target.cancelledAt = null;
  return target;
}