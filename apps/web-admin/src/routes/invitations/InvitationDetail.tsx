import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { ErrorBanner } from '../../components/ErrorBanner';
import { InvitationStatusBadge } from '../../components/InvitationStatusBadge';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import {
  cancelInvitation,
  getInvitation,
  resendInvitation,
} from '../../api/invitations-client';
import type { Invitation } from '../../api/invitations-types';
import { ApiError } from '../../api/types';
import { formatTimestamp, relativeTime } from '../../lib/format';

export function InvitationDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInvitation(id)
      .then((res) => { if (!cancelled) setInvitation(res); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({
            code:    'UNKNOWN',
            message: err instanceof Error ? err.message : 'Failed to load invitation.',
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function handleResend() {
    if (!invitation) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await resendInvitation(invitation.id);
      setInvitation(updated);
    } catch (err) {
      setError({
        code:    err instanceof ApiError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'Couldn’t resend invitation.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!invitation) return;
    setBusy(true);
    setError(null);
    try {
      await cancelInvitation(invitation.id);
      const refreshed = await getInvitation(invitation.id);
      setInvitation(refreshed);
    } catch (err) {
      setError({
        code:    err instanceof ApiError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'Couldn’t cancel invitation.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <BackLink />
        <div className="mt-6 h-32 animate-pulse rounded-md border border-gray-200 bg-white" aria-busy="true" />
      </AppShell>
    );
  }

  if (!invitation) {
    return (
      <AppShell heading="Invitation not found">
        <BackLink />
        {error && <ErrorBanner code={error.code} message={error.message} />}
        <p className="mt-4 text-sm text-gray-600">
          This invitation either doesn’t exist or you don’t have access to it.
        </p>
        <div className="mt-4">
          <SecondaryButton onClick={() => navigate('/invitations')}>
            Back to invitations
          </SecondaryButton>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <BackLink />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="break-all text-xl font-semibold text-[#0B1F3A] sm:text-2xl">
            {invitation.acceptingCompanyName ?? invitation.email}
          </h1>
          {invitation.acceptingCompanyName && (
            <p className="break-all text-sm text-gray-600">{invitation.email}</p>
          )}
        </div>
        <InvitationStatusBadge status={invitation.status} />
      </div>

      {error && <div className="mt-4"><ErrorBanner code={error.code} message={error.message} /></div>}

      <dl className="mt-6 grid grid-cols-1 gap-4 rounded-md border border-gray-200 bg-white p-5 sm:grid-cols-2">
        <Detail label="Sent">
          <span title={formatTimestamp(invitation.sentAt)}>
            {formatTimestamp(invitation.sentAt)}
          </span>
        </Detail>
        {invitation.status === 'sent' && (
          <Detail label="Expires">
            <span title={formatTimestamp(invitation.expiresAt)}>
              {formatTimestamp(invitation.expiresAt)} ({relativeTime(invitation.expiresAt)})
            </span>
          </Detail>
        )}
        {invitation.acceptedAt && (
          <Detail label="Accepted">
            <span title={formatTimestamp(invitation.acceptedAt)}>
              {formatTimestamp(invitation.acceptedAt)}
            </span>
          </Detail>
        )}
        {invitation.cancelledAt && (
          <Detail label="Cancelled">
            <span title={formatTimestamp(invitation.cancelledAt)}>
              {formatTimestamp(invitation.cancelledAt)}
            </span>
          </Detail>
        )}
        <Detail label="Sponsored cost">
          {invitation.sponsoredCost ? 'Yes' : 'No'}
        </Detail>
        <Detail label="Inviter">
          {invitation.inviterCompanyName}
        </Detail>
      </dl>

      {invitation.message && (
        <section className="mt-4 rounded-md border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Personal message
          </p>
          <p className="mt-1.5 whitespace-pre-line text-sm text-[#1F2937]">
            {invitation.message}
          </p>
        </section>
      )}

      <Timeline invitation={invitation} />

      {invitation.status === 'sent' || invitation.status === 'expired' ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <PrimaryButton onClick={handleResend} loading={busy}>
            Resend invitation
          </PrimaryButton>
          {invitation.status === 'sent' && (
            <SecondaryButton onClick={handleCancel} disabled={busy}>
              Cancel invitation
            </SecondaryButton>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-[#1F2937]">{children}</dd>
    </div>
  );
}

function Timeline({ invitation }: { invitation: Invitation }) {
  const events: { ts: number | null; label: string; note?: string }[] = [
    { ts: invitation.sentAt,             label: `Sent to ${invitation.email}` },
    invitation.emailOpenedAt
      ? { ts: invitation.emailOpenedAt,  label: 'Email opened' }
      : { ts: null,                       label: 'Email opened (not yet)' },
    invitation.onboardingStartedAt
      ? { ts: invitation.onboardingStartedAt, label: 'Started onboarding' }
      : { ts: null,                       label: 'Started onboarding (not yet)' },
    invitation.acceptedAt
      ? { ts: invitation.acceptedAt,     label: 'Verified' }
      : invitation.status === 'expired'
        ? { ts: invitation.expiresAt,    label: 'Expired' }
        : invitation.status === 'cancelled' && invitation.cancelledAt
          ? { ts: invitation.cancelledAt, label: 'Cancelled' }
          : { ts: null,                   label: 'Verified (pending)' },
  ];

  return (
    <section
      aria-labelledby="timeline-heading"
      className="mt-6 rounded-md border border-gray-200 bg-white p-5"
    >
      <h2
        id="timeline-heading"
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        Timeline
      </h2>
      <ol className="mt-3 space-y-3">
        {events.map((ev, i) => {
          const done = ev.ts !== null;
          return (
            <li key={i} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={[
                  'mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2',
                  done
                    ? 'bg-[#0F9D58] ring-[#0F9D58]/20'
                    : 'bg-white ring-gray-300',
                ].join(' ')}
              />
              <div className="min-w-0 flex-1">
                <p className={done ? 'text-sm text-[#1F2937]' : 'text-sm text-gray-400'}>
                  {ev.label}
                </p>
                {ev.ts !== null && (
                  <p className="text-xs text-gray-500">
                    {formatTimestamp(ev.ts)} · {relativeTime(ev.ts)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function BackLink() {
  return (
    <Link
      to="/invitations"
      className="inline-flex items-center gap-1 text-sm font-medium text-[#0D6EFD] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
    >
      ← Back to invitations
    </Link>
  );
}
