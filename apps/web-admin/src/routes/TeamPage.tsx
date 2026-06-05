// PFL-128: team management — invite employees + view sent invitations.
//
// This page is intentionally separate from the existing counterparty
// `/invitations` routes (those manage who you EMAIL with; this manages
// who works AT your company). Same backend collection design as
// employee_invitations in apps/functions.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import {
  fetchInvitations,
  type AdminInvitation,
} from '../lib/admin-data';
import {
  inviteEmployee,
  UserManagementError,
} from '../api/user-management-client';

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms < 1e12 ? ms * 1000 : ms);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
}

function resolveCompanyId(): string {
  if (typeof window !== 'undefined') {
    const fromParam = new URLSearchParams(window.location.search).get('cid');
    if (fromParam && fromParam.trim()) return fromParam.trim();
    const fromStorage = window.localStorage.getItem('proofline-company-id');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  }
  return '';
}

export function TeamPage() {
  const cid = resolveCompanyId();
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInvitations(cid)
      .then((res) => { if (!cancelled) setInvitations(res); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cid, refreshTick]);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  return (
    <AppShell
      eyebrow="Admin"
      heading="Team"
      description={
        <>
          Invite teammates by email. Use the <Link to="/dashboard" className="text-[#0D6EFD] underline">dashboard</Link> to
          change roles or deactivate users.
        </>
      }
    >
      <div className="space-y-6">
        <InviteForm onSent={refresh} />
        <InvitationsList invitations={invitations} loading={loading} />
      </div>
    </AppShell>
  );
}

// ─── Invite form ─────────────────────────────────────────────────────────────

function InviteForm({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState<'employee' | 'manager'>('employee');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<{ code: string; detail: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await inviteEmployee(trimmed, role);
      setSuccess(`Invitation sent to ${res.email}`);
      setEmail('');
      setRole('employee');
      onSent();
    } catch (err) {
      if (err instanceof UserManagementError) {
        setError({ code: err.code, detail: err.message });
      } else {
        setError({ code: 'UNKNOWN', detail: err instanceof Error ? err.message : 'Invitation failed' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="invite-heading" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="invite-heading" className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        Invite an employee
      </h2>
      {success && (
        <div role="status" className="mb-3 rounded-md border border-[#0F9D58]/30 bg-[#0F9D58]/10 px-3 py-2 text-sm text-[#0F9D58]">
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-medium">{error.code}</span> — {error.detail}
        </div>
      )}
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@example.com"
            disabled={busy}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0D6EFD] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD]/30 disabled:bg-gray-50"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'employee' | 'manager')}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0D6EFD] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD]/30 disabled:bg-gray-50"
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="h-10 rounded-md bg-[#0D6EFD] px-4 text-sm font-medium text-white shadow-sm hover:bg-[#0B5ED7] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>
    </section>
  );
}

// ─── Invitations list ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, string> = {
    pending:  'border-amber-200 bg-amber-50 text-[#B45309]',
    accepted: 'border-[#0F9D58]/30 bg-[#0F9D58]/10 text-[#0F9D58]',
    expired:  'border-gray-300 bg-gray-50 text-gray-500',
    revoked:  'border-red-200 bg-red-50 text-red-700',
  };
  const cls = palette[status] ?? 'border-gray-200 bg-white text-gray-600';
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function InvitationsList({
  invitations, loading,
}: { invitations: AdminInvitation[]; loading: boolean }) {
  return (
    <section aria-labelledby="invitations-heading" className="space-y-3">
      <h2 id="invitations-heading" className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Invitations {invitations.length > 0 && <span className="text-gray-400">({invitations.length})</span>}
      </h2>
      {loading && invitations.length === 0 ? (
        <ul className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-14 animate-pulse rounded-md border border-gray-200 bg-white" />
          ))}
        </ul>
      ) : invitations.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
          No employee invitations yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {invitations.map((inv) => (
            <li
              key={inv.invitationId}
              className="flex flex-wrap items-baseline gap-3 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#0B1F3A]">{inv.email}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  sent {fmtDate(inv.createdAt)}
                  {inv.acceptedAt !== null && (
                    <> · accepted {fmtDate(inv.acceptedAt)}</>
                  )}
                  {inv.acceptedAt === null && inv.expiresAt !== null && (
                    <> · expires {fmtDate(inv.expiresAt)}</>
                  )}
                </p>
              </div>
              <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {inv.role}
              </span>
              <StatusBadge status={inv.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
