import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  fetchCompanyProfile,
  fetchUsers,
  fetchRecentSignedMessages,
  fetchActiveSessions,
  type CompanyProfile,
  type AdminUser,
  type AdminSignedMessage,
  type AdminSession,
} from '../lib/admin-data';

// PFL-111: real admin dashboard reading live Firestore data (company,
// users, signed messages, sessions). Replaces the invitations-focused
// placeholder (kept as DashboardHome.old.tsx). All reads are graceful —
// a missing backend / closed rules / missing config renders empty states,
// never an error screen.

// companyId resolution: ?cid= → localStorage → empty (prompts the user).
function resolveCompanyId(): string {
  if (typeof window !== 'undefined') {
    const fromParam = new URLSearchParams(window.location.search).get('cid');
    if (fromParam && fromParam.trim()) return fromParam.trim();
    const fromStorage = window.localStorage.getItem('proofline-company-id');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  }
  return '';
}

function fmtDate(ms: number | null): string {
  if (ms === null) return '—';
  // Stored timestamps are unix ms (Date.now()). Guard against accidental sec.
  const d = new Date(ms < 1e12 ? ms * 1000 : ms);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
}

function truncate(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function DashboardHome() {
  const cid = resolveCompanyId();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [messages, setMessages] = useState<AdminSignedMessage[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchCompanyProfile(cid),
      fetchUsers(cid),
      fetchRecentSignedMessages(cid, 10),
      fetchActiveSessions(cid),
    ])
      .then(([c, u, m, s]) => {
        if (cancelled) return;
        setCompany(c);
        setUsers(u);
        setMessages(m);
        setSessions(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cid]);

  const heading = company?.legalName ?? (cid ? 'Company dashboard' : 'Admin dashboard');

  return (
    <AppShell
      eyebrow="Admin"
      heading={heading}
      description={
        cid
          ? <>Live company registry, users, signed mail, and active sessions.</>
          : <>No company selected — append <code className="font-mono text-[#0B1F3A]">?cid=&lt;companyId&gt;</code> or set <code className="font-mono text-[#0B1F3A]">proofline-company-id</code> in localStorage.</>
      }
    >
      <div className="space-y-6">
        <CompanyCard company={company} cid={cid} loading={loading} />
        <UsersSection users={users} loading={loading} />
        <SignedMessagesSection messages={messages} loading={loading} />
        <SessionsSection sessions={sessions} loading={loading} />
      </div>
    </AppShell>
  );
}

// ─── Company profile card ──────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const verified = status === 'verified';
  const cls = verified
    ? 'bg-[#0F9D58]/10 text-[#0F9D58] border-[#0F9D58]/30'
    : 'bg-amber-50 text-[#B45309] border-amber-200';
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2 last:border-0 sm:flex-row sm:items-start sm:gap-4">
      <dt className="min-w-[140px] shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="break-all text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function CompanyCard({
  company, cid, loading,
}: { company: CompanyProfile | null; cid: string; loading: boolean }) {
  return (
    <section aria-labelledby="company-heading" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="company-heading" className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        Company profile
      </h2>
      {loading && !company ? (
        <Skeleton rows={4} />
      ) : !company ? (
        <p className="text-sm text-gray-500">
          {cid
            ? `No company found for ${truncate(cid)}.`
            : 'Select a company to view its profile.'}
        </p>
      ) : (
        <dl>
          <Row label="Legal name" value={company.legalName} />
          <Row label="Domain" value={company.domain || '—'} />
          <Row label="Status" value={<StatusPill status={company.status} />} />
          <Row label="Created" value={fmtDate(company.createdAt)} />
          <Row label="Verified" value={fmtDate(company.verifiedAt)} />
          <Row
            label="Root key"
            value={<span className="font-mono text-xs">{company.rootPublicKey ? truncate(company.rootPublicKey, 12, 8) : '—'}</span>}
          />
          <Row
            label="Anchor"
            value={
              company.anchorBlockNumber && company.anchorBlockNumber > 0
                ? <span>block #{company.anchorBlockNumber}{company.anchorTxHash ? <span className="ml-2 font-mono text-xs text-gray-500">{truncate(company.anchorTxHash, 8, 6)}</span> : null}</span>
                : <span className="text-gray-500">pending</span>
            }
          />
        </dl>
      )}
    </section>
  );
}

// ─── Users table ───────────────────────────────────────────────────────────

function RolePill({ role }: { role: string }) {
  return (
    <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {role}
    </span>
  );
}

function UsersSection({ users, loading }: { users: AdminUser[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return (
    <section aria-labelledby="users-heading" className="space-y-3">
      <h2 id="users-heading" className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Users {users.length > 0 && <span className="text-gray-400">({users.length})</span>}
      </h2>
      {loading && users.length === 0 ? (
        <Skeleton rows={2} />
      ) : users.length === 0 ? (
        <EmptyCard>No users found for this company.</EmptyCard>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => {
            const isOpen = expanded.has(u.userId);
            return (
              <li key={u.userId} className="rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => toggle(u.userId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#0B1F3A]">{u.displayName}</p>
                    <p className="truncate text-sm text-gray-600">{u.email || '—'}</p>
                  </div>
                  <RolePill role={u.role} />
                  <span className="shrink-0 text-xs text-gray-500">
                    {u.devices.length} {u.devices.length === 1 ? 'device' : 'devices'}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-gray-400">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Devices</p>
                    {u.devices.length === 0 ? (
                      <p className="text-sm text-gray-500">No enrolled devices.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {u.devices.map((dev, i) => (
                          <li key={dev.credentialId || i} className="flex items-baseline gap-2 text-sm">
                            <span className="font-mono text-xs text-[#1F2937]">{truncate(dev.credentialId, 10, 6)}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-500">enrolled {fmtDate(dev.enrolledAt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-gray-400">Status: {u.status}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Recent signed messages ────────────────────────────────────────────────

function SignedMessagesSection({
  messages, loading,
}: { messages: AdminSignedMessage[]; loading: boolean }) {
  return (
    <section aria-labelledby="signed-heading" className="space-y-3">
      <h2 id="signed-heading" className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Recent signed messages
      </h2>
      {loading && messages.length === 0 ? (
        <Skeleton rows={3} />
      ) : messages.length === 0 ? (
        <EmptyCard>No signed messages yet.</EmptyCard>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#0B1F3A]">{m.subject}</p>
                {m.anchored ? (
                  <span className="shrink-0 rounded border border-[#0F9D58]/30 bg-[#0F9D58]/10 px-2 py-0.5 text-xs font-medium text-[#0F9D58]">
                    anchored #{m.anchorBlockNumber}
                  </span>
                ) : (
                  <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-[#B45309]">
                    pending
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-gray-600">
                <span className="text-gray-400">from</span> {m.from || '—'}{' '}
                <span className="text-gray-400">to</span> {m.to.join(', ') || '—'}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">Signed {fmtDate(m.signedAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Active sessions ───────────────────────────────────────────────────────

function SessionsSection({
  sessions, loading,
}: { sessions: AdminSession[]; loading: boolean }) {
  return (
    <section aria-labelledby="sessions-heading" className="space-y-3">
      <h2 id="sessions-heading" className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Active sessions {sessions.length > 0 && <span className="text-gray-400">({sessions.length})</span>}
      </h2>
      {loading && sessions.length === 0 ? (
        <Skeleton rows={2} />
      ) : sessions.length === 0 ? (
        <EmptyCard>No active signing sessions.</EmptyCard>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium text-[#0B1F3A]">{truncate(s.userId, 12, 6)}</p>
                <p className="text-xs text-gray-500">
                  authorized {fmtDate(s.authorizedAt)} · expires {fmtDate(s.expiresAt)}
                </p>
              </div>
              <p className="mt-0.5 truncate text-sm text-gray-600">
                <span className="text-gray-400">recipient</span>{' '}
                <span className="font-mono text-xs">{truncate(s.recipient, 12, 6)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
      {children}
    </p>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <ul className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="h-12 animate-pulse rounded-md border border-gray-200 bg-white" />
      ))}
    </ul>
  );
}
