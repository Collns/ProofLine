import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { ErrorBanner } from '../components/ErrorBanner';
import { InvitationCard } from '../components/InvitationCard';
import { NetworkCoverageMeter } from '../components/NetworkCoverageMeter';
import {
  getNetworkStats,
  listInvitations,
} from '../api/invitations-client';
import type { Invitation, NetworkStats } from '../api/invitations-types';
import { ApiError } from '../api/types';

const RECENT_LIMIT = 5;

// PFL-110: resolve the company name without a real auth flow yet.
// Priority: ?company= URL param → localStorage 'proofline-company-name'
// → generic fallback. (TODO(PFL-AUTH): pull legalName from the
// authenticated company once login lands.)
function resolveCompanyName(): string {
  if (typeof window !== 'undefined') {
    const fromParam = new URLSearchParams(window.location.search).get('company');
    if (fromParam && fromParam.trim().length > 0) return fromParam.trim();
    const fromStorage = window.localStorage.getItem('proofline-company-name');
    if (fromStorage && fromStorage.trim().length > 0) return fromStorage.trim();
  }
  return 'your company';
}

export function DashboardHome() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [recent, setRecent] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const companyName = resolveCompanyName();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getNetworkStats(),
      listInvitations({ pageSize: RECENT_LIMIT, page: 1 }),
    ])
      .then(([s, list]) => {
        if (cancelled) return;
        setStats(s);
        setRecent(list.items.slice(0, RECENT_LIMIT));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // PFL-110: the invitations backend isn't deployed yet. Treat
        // API/network failures as "no data" (empty defaults) rather than
        // surfacing a scary red banner — the dashboard is still usable.
        // Only genuinely unexpected (non-ApiError) failures show the banner.
        if (err instanceof ApiError) {
          setStats(emptyStats());
          setRecent([]);
        } else {
          setError({
            code:    'UNKNOWN',
            message: err instanceof Error ? err.message : 'Failed to load dashboard.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      eyebrow="Verified"
      heading={`Welcome, ${companyName}.`}
      description={
        <>You’re verified. Bring your counterparties online to transact securely.</>
      }
    >
      <div className="space-y-6">
        {error && <ErrorBanner code={error.code} message={error.message} />}

        <NetworkCoverageMeter
          stats={stats ?? emptyStats()}
          loading={loading && !stats}
        />

        <section
          aria-labelledby="recent-heading"
          className="space-y-3"
        >
          <div className="flex items-baseline justify-between">
            <h2
              id="recent-heading"
              className="text-sm font-semibold uppercase tracking-wide text-gray-500"
            >
              Recent invitations
            </h2>
            {recent.length > 0 && (
              <Link
                to="/invitations"
                className="text-sm font-medium text-[#0D6EFD] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
              >
                View all →
              </Link>
            )}
          </div>
          {loading && recent.length === 0 ? (
            <RecentSkeleton />
          ) : recent.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
              You haven't invited anyone yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <InvitationCard invitation={inv} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="invite-cta-heading"
          className="rounded-lg border border-[#0D6EFD]/30 bg-[#0D6EFD]/5 p-5 sm:p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2
                id="invite-cta-heading"
                className="text-lg font-semibold text-[#0B1F3A]"
              >
                Invite counterparties
              </h2>
              <p className="text-sm text-gray-600">
                Title companies, escrow agents, banks — bring the people you
                already transact with onto ProofLine.
              </p>
            </div>
            <Link
              to="/invitations/new"
              className={[
                'inline-flex shrink-0 items-center justify-center gap-2 rounded-md',
                'bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm',
                'transition-colors duration-200 hover:bg-[#0B5BD6]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
                'min-h-[48px] w-full sm:w-auto',
              ].join(' ')}
            >
              + Invite counterparties
            </Link>
          </div>
        </section>

        <section
          aria-labelledby="resources-heading"
          className="rounded-md border border-gray-200 bg-white p-5"
        >
          <h2
            id="resources-heading"
            className="text-sm font-semibold uppercase tracking-wide text-gray-500"
          >
            Resources
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-[#1F2937]">
            <li>
              <a
                href="https://chrome.google.com/webstore/search/proofline"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0D6EFD] hover:underline"
              >
                Install the ProofLine extension
              </a>{' '}
              <span className="text-gray-500">— sign emails directly in Gmail.</span>
            </li>
            <li>
              <Link
                to="/onboarding"
                className="font-medium text-[#0D6EFD] hover:underline"
              >
                Add another company
              </Link>{' '}
              <span className="text-gray-500">— run onboarding for an additional entity.</span>
            </li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function emptyStats(): NetworkStats {
  return {
    totalInvited:    0,
    verified:        0,
    pending:         0,
    expired:         0,
    cancelled:       0,
    coveragePercent: 0,
  };
}

function RecentSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-14 animate-pulse rounded-md border border-gray-200 bg-white"
        />
      ))}
    </ul>
  );
}
