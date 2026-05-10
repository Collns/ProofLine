import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { ErrorBanner } from '../../components/ErrorBanner';
import { InvitationStatusBadge } from '../../components/InvitationStatusBadge';
import {
  cancelInvitation,
  listInvitations,
  resendInvitation,
} from '../../api/invitations-client';
import type {
  Invitation,
  InvitationStatus,
  ListInvitationsResult,
} from '../../api/invitations-types';
import { ApiError } from '../../api/types';
import { relativeTime } from '../../lib/format';

const PAGE_SIZE = 25;
const STATUS_OPTIONS: { value: InvitationStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'sent',      label: 'Sent' },
  { value: 'accepted',  label: 'Verified' },
  { value: 'expired',   label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function InvitationsList() {
  const [params, setParams] = useSearchParams();
  const status =
    (params.get('status') as InvitationStatus | 'all' | null) ?? 'all';
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [data, setData] = useState<ListInvitationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listInvitations({
      status,
      page,
      pageSize: PAGE_SIZE,
      search:   search.trim() || undefined,
    })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({
            code:    'UNKNOWN',
            message: err instanceof Error ? err.message : 'Failed to load invitations.',
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, page, search, refreshTick]);

  function update(key: string, value: string | undefined) {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  async function handleResend(id: string) {
    setActingId(id);
    try {
      await resendInvitation(id);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError({
        code:    err instanceof ApiError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'Couldn’t resend invitation.',
      });
    } finally {
      setActingId(null);
    }
  }

  async function handleCancel(id: string) {
    setActingId(id);
    try {
      await cancelInvitation(id);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setError({
        code:    err instanceof ApiError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'Couldn’t cancel invitation.',
      });
    } finally {
      setActingId(null);
    }
  }

  const pageCount = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  return (
    <AppShell
      eyebrow="Counterparty invitations"
      heading="Invitations"
      description={
        <>Track every counterparty you’ve invited. Resend pending, view verified.</>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="invitations-search"
                className="block text-xs font-medium uppercase tracking-wide text-gray-500"
              >
                Search
              </label>
              <input
                id="invitations-search"
                type="search"
                value={search}
                onChange={(e) => update('q', e.target.value)}
                placeholder="email or company"
                className="block w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-[#1F2937] placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:border-[#0D6EFD] sm:w-64"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="invitations-status"
                className="block text-xs font-medium uppercase tracking-wide text-gray-500"
              >
                Status
              </label>
              <select
                id="invitations-status"
                value={status}
                onChange={(e) => update('status', e.target.value === 'all' ? undefined : e.target.value)}
                className="block w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-[#1F2937] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:border-[#0D6EFD] sm:w-44"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <Link
            to="/invitations/new"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
          >
            + Invite counterparties
          </Link>
        </div>

        {error && <ErrorBanner code={error.code} message={error.message} />}

        {loading && !data ? (
          <ListSkeleton />
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="space-y-2 sm:hidden">
              {data.items.map((inv) => (
                <li key={inv.id}>
                  <MobileRow
                    invitation={inv}
                    busy={actingId === inv.id}
                    onResend={() => handleResend(inv.id)}
                    onCancel={() => handleCancel(inv.id)}
                  />
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Email</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5">Sent</th>
                    <th scope="col" className="px-4 py-2.5">Accepted</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.items.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/invitations/${inv.id}`}
                          className="font-medium text-[#0B1F3A] hover:text-[#0D6EFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
                        >
                          {inv.acceptingCompanyName ?? inv.email}
                        </Link>
                        {inv.acceptingCompanyName ? (
                          <span className="block text-xs text-gray-500">{inv.email}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <InvitationStatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {relativeTime(inv.sentAt)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {inv.acceptedAt ? relativeTime(inv.acceptedAt) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <RowActions
                          invitation={inv}
                          busy={actingId === inv.id}
                          onResend={() => handleResend(inv.id)}
                          onCancel={() => handleCancel(inv.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              total={data.total}
              onChange={(next) => update('page', next === 1 ? undefined : String(next))}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function MobileRow({
  invitation,
  busy,
  onResend,
  onCancel,
}: {
  invitation: Invitation;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to={`/invitations/${invitation.id}`}
            className="block truncate text-sm font-medium text-[#0B1F3A]"
          >
            {invitation.acceptingCompanyName ?? invitation.email}
          </Link>
          <p className="truncate text-xs text-gray-500">
            {invitation.acceptingCompanyName ? invitation.email : 'sent ' + relativeTime(invitation.sentAt)}
          </p>
        </div>
        <InvitationStatusBadge status={invitation.status} />
      </div>
      <div className="mt-2 flex justify-end">
        <RowActions
          invitation={invitation}
          busy={busy}
          onResend={onResend}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

function RowActions({
  invitation,
  busy,
  onResend,
  onCancel,
}: {
  invitation: Invitation;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  if (invitation.status === 'sent') {
    return (
      <div className="flex justify-end gap-2">
        <ActionLink onClick={onResend} disabled={busy}>Resend</ActionLink>
        <ActionLink onClick={onCancel} disabled={busy} variant="muted">
          Cancel
        </ActionLink>
      </div>
    );
  }
  if (invitation.status === 'expired') {
    return (
      <ActionLink onClick={onResend} disabled={busy}>Resend</ActionLink>
    );
  }
  return (
    <Link
      to={`/invitations/${invitation.id}`}
      className="text-xs font-medium text-[#0D6EFD] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
    >
      View
    </Link>
  );
}

function ActionLink({
  onClick,
  disabled,
  children,
  variant,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'muted';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-sm text-xs font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
        variant === 'muted' ? 'text-gray-500' : 'text-[#0D6EFD]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-xs text-gray-500">
        {total} {total === 1 ? 'invitation' : 'invitations'}
      </p>
    );
  }
  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      <p>{total} invitations</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 disabled:opacity-50"
        >
          ← Prev
        </button>
        <span>
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 disabled:opacity-50"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="text-base font-medium text-[#0B1F3A]">
        You haven't invited anyone yet.
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Bring counterparties online to transact securely on ProofLine.
      </p>
      <Link
        to="/invitations/new"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
      >
        + Invite counterparties
      </Link>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="h-12 animate-pulse rounded-md border border-gray-200 bg-white" />
      ))}
    </ul>
  );
}
