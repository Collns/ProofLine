import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { ErrorBanner } from '../../components/ErrorBanner';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import {
  BulkEmailParser,
  parseBulkEmails,
} from '../../components/BulkEmailParser';
import {
  InviteFormSingle,
  type SingleInviteSubmit,
} from '../../components/InviteFormSingle';
import {
  bulkCreateInvitations,
  createInvitation,
  listInvitations,
  BULK_LIMIT,
} from '../../api/invitations-client';
import type {
  BulkInvitationResult,
  Invitation,
} from '../../api/invitations-types';
import { ApiError } from '../../api/types';

const SELF_DOMAIN = 'acme-title.com';

type Mode = 'single' | 'bulk';

export function InviteCounterparties() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('single');
  const [bulkInput, setBulkInput] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkSponsored, setBulkSponsored] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkInvitationResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [singleResult, setSingleResult] = useState<Invitation | null>(null);

  // Pull existing invitations (sent + accepted) once so the bulk-paste
  // preview can warn about repeats. Best-effort — failure is non-fatal.
  const [existing, setExisting] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    listInvitations({ pageSize: 100, page: 1 })
      .then((res) => {
        if (cancelled) return;
        const set = new Set<string>();
        for (const inv of res.items) {
          if (inv.status === 'sent' || inv.status === 'accepted') {
            set.add(inv.email.toLowerCase());
          }
        }
        setExisting(set);
      })
      .catch(() => {
        /* preview-only; proceed without the warning */
      });
    return () => { cancelled = true; };
  }, []);

  const parsed = useMemo(() => parseBulkEmails(bulkInput), [bulkInput]);
  const sendableEmails = useMemo(() => {
    return parsed.valid.filter((e) => {
      const lower = e.toLowerCase();
      if (lower.endsWith(`@${SELF_DOMAIN}`)) return false;
      if (existing.has(lower)) return false;
      return true;
    });
  }, [parsed.valid, existing]);

  async function handleSingleSubmit(input: SingleInviteSubmit) {
    setError(null);
    try {
      const created = await createInvitation({
        email:         input.email,
        message:       input.message ?? undefined,
        sponsoredCost: input.sponsoredCost,
      });
      setSingleResult(created);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code:    'UNKNOWN',
          message: err instanceof Error ? err.message : 'Couldn’t send invitation.',
        });
      }
      throw err;
    }
  }

  async function handleBulkSubmit() {
    if (sendableEmails.length === 0) return;
    setError(null);
    setBulkBusy(true);
    try {
      const result = await bulkCreateInvitations({
        emails:        sendableEmails,
        sponsoredCost: bulkSponsored,
        message:       bulkMessage.trim() ? bulkMessage.trim() : undefined,
      });
      setBulkResult(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code:    'UNKNOWN',
          message: err instanceof Error ? err.message : 'Couldn’t send invitations.',
        });
      }
    } finally {
      setBulkBusy(false);
    }
  }

  // Success state — render either single or bulk confirmation.
  if (singleResult) {
    return (
      <AppShell
        eyebrow="Invitation sent"
        heading="Invitation sent."
        description={
          <>We emailed {singleResult.email}. They have 30 days to verify.</>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            to={`/invitations/${singleResult.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px]"
          >
            View invitation →
          </Link>
          <SecondaryButton onClick={() => setSingleResult(null)}>
            Send another
          </SecondaryButton>
          <SecondaryButton onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </SecondaryButton>
        </div>
      </AppShell>
    );
  }

  if (bulkResult) {
    return (
      <AppShell
        eyebrow="Invitations sent"
        heading={`${bulkResult.created.length} invitation${bulkResult.created.length === 1 ? '' : 's'} sent.`}
        description={
          bulkResult.skipped.length > 0 ? (
            <>{bulkResult.skipped.length} skipped — see details below.</>
          ) : (
            <>All counterparties were emailed. They have 30 days to verify.</>
          )
        }
      >
        <div className="space-y-5">
          {bulkResult.skipped.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-[#0B1F3A]">Skipped</p>
              <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {bulkResult.skipped.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="font-mono truncate">{s.email}</span>
                    <span className="shrink-0 text-gray-500">{describeSkip(s.reason)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/invitations"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px]"
            >
              View invitations →
            </Link>
            <SecondaryButton
              onClick={() => {
                setBulkResult(null);
                setBulkInput('');
              }}
            >
              Send more
            </SecondaryButton>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="Counterparty invitations"
      heading="Invite counterparties"
      description={
        <>Send a single invitation, or paste up to {BULK_LIMIT} emails at once.</>
      }
    >
      <div className="space-y-6">
        {error && <ErrorBanner code={error.code} message={error.message} />}

        <div
          role="tablist"
          aria-label="Invitation mode"
          className="inline-flex rounded-md border border-gray-200 bg-white p-1"
        >
          <ModeTab
            label="Single"
            active={mode === 'single'}
            onClick={() => setMode('single')}
          />
          <ModeTab
            label="Bulk paste"
            active={mode === 'bulk'}
            onClick={() => setMode('bulk')}
          />
        </div>

        {mode === 'single' ? (
          <InviteFormSingle
            onSubmit={handleSingleSubmit}
            selfDomainLowerCase={SELF_DOMAIN}
          />
        ) : (
          <div className="space-y-5">
            <BulkEmailParser
              value={bulkInput}
              onChange={setBulkInput}
              alreadyInvitedLowerCase={existing}
              selfDomainLowerCase={SELF_DOMAIN}
              disabled={bulkBusy}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="bulk-message"
                className="block text-sm font-medium text-[#0B1F3A]"
              >
                Personal message{' '}
                <span className="font-normal text-gray-500">(applies to all, optional)</span>
              </label>
              <textarea
                id="bulk-message"
                rows={3}
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                disabled={bulkBusy}
                placeholder="Hey — we’re sending wires through ProofLine now. Sign up so we can transact securely."
                className={[
                  'block w-full rounded-md border border-gray-200 bg-white px-3 py-2.5',
                  'text-sm text-[#1F2937] placeholder:text-gray-400',
                  'shadow-sm transition-colors duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:border-[#0D6EFD]',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                ].join(' ')}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
              <input
                type="checkbox"
                checked={bulkSponsored}
                onChange={(e) => setBulkSponsored(e.target.checked)}
                disabled={bulkBusy}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0D6EFD] focus:ring-[#0D6EFD]"
              />
              <span className="text-sm text-[#1F2937]">
                <span className="font-medium text-[#0B1F3A]">Sponsor onboarding cost</span>
                <span className="block text-xs text-gray-500">
                  Applies to every invitation in this batch.
                </span>
              </span>
            </label>

            <PrimaryButton
              onClick={handleBulkSubmit}
              loading={bulkBusy}
              disabled={sendableEmails.length === 0}
            >
              {sendableEmails.length === 0
                ? 'Send invitations'
                : `Send ${sendableEmails.length} invitation${sendableEmails.length === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150',
        active
          ? 'bg-[#0D6EFD] text-white'
          : 'text-gray-600 hover:text-[#0B1F3A]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function describeSkip(reason: string): string {
  switch (reason) {
    case 'invalid_email':      return 'invalid email';
    case 'duplicate_in_batch': return 'duplicate in this batch';
    case 'already_invited':    return 'already invited';
    case 'self_domain':        return 'on your own domain';
    case 'over_limit':         return `over ${BULK_LIMIT}-invite limit`;
    default:                   return reason;
  }
}
