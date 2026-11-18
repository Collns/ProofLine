import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import {
  fetchCompanyProfile,
  fetchUsers,
  fetchRecentSignedMessages,
  fetchActiveSessions,
  type CompanyProfile,
  type AdminUser,
  type AdminDevice,
  type AdminSignedMessage,
  type AdminSession,
} from '../lib/admin-data';
import { revokeDevice } from '../api/devices-client';
import {
  updateUserRole,
  updateUserStatus,
  revokeSession,
  UserManagementError,
} from '../api/user-management-client';
import { useAuth } from '../contexts/AuthContext';

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
  const { user } = useAuth();
  const callerUid = user?.uid ?? '';
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [messages, setMessages] = useState<AdminSignedMessage[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  // PFL-085: bump to trigger a refetch (post-revoke).
  const [refreshTick, setRefreshTick] = useState(0);

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
  }, [cid, refreshTick]);

  // PFL-130: auto-refresh so the sessions list tracks reality without a
  // manual reload. Sections only skeleton when they have no data, so
  // the periodic refetch never flashes.
  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // PFL-128: derive the caller's role from the users list so the UI can
  // gate role-edit (owner only) and deactivate (owner OR manager) and
  // skip controls on the caller's own row. Falls back to "employee" so
  // a not-yet-loaded users list never accidentally exposes controls.
  const callerRole: 'owner' | 'manager' | 'employee' =
    (users.find((u) => u.userId === callerUid)?.role as 'owner' | 'manager' | 'employee' | undefined) ?? 'employee';

  // Optimistic in-place patch — used by role/status mutations so the
  // user list reflects the change instantly. Errors roll back via
  // refreshTick.
  function patchUser(userId: string, patch: Partial<AdminUser>) {
    setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, ...patch } : u)));
  }

  const heading = company?.legalName ?? (cid ? 'Company dashboard' : 'Admin dashboard');

  return (
    <AppShell
      eyebrow="Admin"
      heading={heading}
      description={
        cid
          ? (
            <>
              Live company registry, users, signed mail, and active sessions.{' '}
              <Link to="/team" className="text-[#0D6EFD] underline">Invite a teammate →</Link>
            </>
          )
          : <>No company selected — append <code className="font-mono text-[#0B1F3A]">?cid=&lt;companyId&gt;</code> or set <code className="font-mono text-[#0B1F3A]">proofline-company-id</code> in localStorage.</>
      }
    >
      <div className="space-y-6">
        <CompanyCard company={company} cid={cid} loading={loading} />
        <UsersSection
          users={users}
          loading={loading}
          callerUid={callerUid}
          callerRole={callerRole}
          onChanged={() => setRefreshTick((n) => n + 1)}
          onOptimisticPatch={patchUser}
        />
        <SignedMessagesSection messages={messages} loading={loading} />
        <SessionsSection
          sessions={sessions}
          users={users}
          loading={loading}
          callerUid={callerUid}
          callerRole={callerRole}
          onChanged={() => setRefreshTick((n) => n + 1)}
        />
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

function UsersSection({
  users, loading, callerUid, callerRole, onChanged, onOptimisticPatch,
}: {
  users: AdminUser[];
  loading: boolean;
  callerUid: string;
  callerRole: 'owner' | 'manager' | 'employee';
  onChanged: () => void;
  onOptimisticPatch: (userId: string, patch: Partial<AdminUser>) => void;
}) {
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
            const activeDeviceCount = u.devices.filter((d) => d.revokedAt === null).length;
            const isSelf       = u.userId === callerUid;
            const isInactive   = u.status === 'inactive';
            return (
              <li
                key={u.userId}
                className={`rounded-xl border border-gray-200 bg-white ${isInactive ? 'opacity-60' : ''}`}
              >
                <div className="flex w-full items-center gap-3 p-4 text-left">
                  <button
                    type="button"
                    onClick={() => toggle(u.userId)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#0B1F3A]">{u.displayName}</p>
                      <p className="truncate text-sm text-gray-600">{u.email || '—'}</p>
                    </div>
                  </button>
                  <RoleControl
                    user={u}
                    callerUid={callerUid}
                    callerRole={callerRole}
                    onOptimisticPatch={onOptimisticPatch}
                    onChanged={onChanged}
                  />
                  <span className="shrink-0 text-xs text-gray-500">
                    {activeDeviceCount} {activeDeviceCount === 1 ? 'device' : 'devices'}
                    {u.devices.length > activeDeviceCount && (
                      <span className="ml-1 text-gray-400">({u.devices.length} total)</span>
                    )}
                  </span>
                  {!isSelf && (
                    <StatusControl
                      user={u}
                      callerRole={callerRole}
                      onOptimisticPatch={onOptimisticPatch}
                      onChanged={onChanged}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(u.userId)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    className="shrink-0 text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD]"
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Devices</p>
                    {u.devices.length === 0 ? (
                      <p className="text-sm text-gray-500">No enrolled devices.</p>
                    ) : (
                      <ul className="space-y-2">
                        {u.devices.map((dev, i) => (
                          <DeviceRow
                            key={dev.credentialId || i}
                            userId={u.userId}
                            device={dev}
                            onChanged={onChanged}
                          />
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-gray-400">User status: {u.status}</p>
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

// ─── Role control ─────────────────────────────────────────────────────────────
//
// PFL-128: owners see a dropdown to flip role between employee and
// manager (the API refuses owner promotions). Non-owners and the
// caller's own row show the static RolePill.

function RoleControl({
  user, callerUid, callerRole, onOptimisticPatch, onChanged,
}: {
  user: AdminUser;
  callerUid: string;
  callerRole: 'owner' | 'manager' | 'employee';
  onOptimisticPatch: (userId: string, patch: Partial<AdminUser>) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Can't change: caller isn't owner, target is the caller, or target
  // is the owner (server enforces, UI shadows).
  const canEdit =
    callerRole === 'owner' && user.userId !== callerUid && user.role !== 'owner';

  if (!canEdit) {
    return <RolePill role={user.role} />;
  }

  async function handleChange(next: string) {
    if (next !== 'employee' && next !== 'manager') return;
    if (next === user.role) return;
    setError(null);
    const previousRole = user.role;
    onOptimisticPatch(user.userId, { role: next });
    setBusy(true);
    try {
      await updateUserRole(user.userId, next);
      onChanged();
    } catch (err) {
      // Rollback the optimistic patch and surface the error.
      onOptimisticPatch(user.userId, { role: previousRole });
      const msg = err instanceof UserManagementError ? `${err.code}: ${err.message}` :
                  err instanceof Error ? err.message : 'Role change failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={user.role}
        onChange={(e) => handleChange(e.target.value)}
        disabled={busy}
        aria-label={`Role for ${user.displayName}`}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-[#0D6EFD] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD]/30 disabled:opacity-60"
      >
        <option value="employee">employee</option>
        <option value="manager">manager</option>
      </select>
      {error && <span className="max-w-[200px] truncate text-xs text-red-700" title={error}>{error}</span>}
    </div>
  );
}

// ─── Status control ───────────────────────────────────────────────────────────
//
// PFL-128: owners can deactivate any non-owner; managers can only flip
// employees. Caller's own row hides this control (the server enforces
// SELF_CHANGE anyway). Deactivated users show a Reactivate button.

function StatusControl({
  user, callerRole, onOptimisticPatch, onChanged,
}: {
  user: AdminUser;
  callerRole: 'owner' | 'manager' | 'employee';
  onOptimisticPatch: (userId: string, patch: Partial<AdminUser>) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Visibility: owners on anyone non-owner; managers on employees only.
  const canMutate =
    callerRole === 'owner'
      ? user.role !== 'owner'
      : callerRole === 'manager'
        ? user.role === 'employee'
        : false;

  if (!canMutate) return null;

  const isInactive = user.status === 'inactive';

  async function handleClick() {
    const next: 'active' | 'inactive' = isInactive ? 'active' : 'inactive';
    const verb = isInactive ? 'Reactivate' : 'Deactivate';
    if (!isInactive) {
      const ok = typeof window === 'undefined'
        ? true
        : window.confirm(
            `${verb} ${user.displayName || user.email}? ` +
            `All active sessions will be killed and all enrolled devices will be revoked. ` +
            `They will need to re-enroll their device to come back online.`,
          );
      if (!ok) return;
    }
    setError(null);
    const previousStatus = user.status;
    onOptimisticPatch(user.userId, { status: next });
    setBusy(true);
    try {
      await updateUserStatus(user.userId, next);
      onChanged();   // refetch so device-revoked states + session counts match server
    } catch (err) {
      onOptimisticPatch(user.userId, { status: previousStatus });
      const msg = err instanceof UserManagementError ? `${err.code}: ${err.message}` :
                  err instanceof Error ? err.message : 'Status change failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={`rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
          isInactive
            ? 'border-[#0F9D58]/30 bg-white text-[#0F9D58] hover:bg-[#0F9D58]/10'
            : 'border-red-200 bg-white text-red-700 hover:bg-red-50'
        }`}
      >
        {busy ? '…' : isInactive ? 'Reactivate' : 'Deactivate'}
      </button>
      {error && <span className="max-w-[200px] truncate text-xs text-red-700" title={error}>{error}</span>}
    </div>
  );
}

function DeviceRow({
  userId, device, onChanged,
}: { userId: string; device: AdminDevice; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = device.revokedAt !== null;

  async function handleRevoke() {
    // The revoke endpoint needs the caller's extension auth Bearer. The
    // admin app stashes one in localStorage when the user authenticates
    // through the sign popup; if absent, surface a friendly hint instead
    // of failing silently.
    const bearer = typeof window !== 'undefined'
      ? window.localStorage.getItem('proofline-auth-token')
      : null;
    if (!bearer) {
      setError('Sign in via the extension first so the dashboard has an auth token.');
      return;
    }
    if (!window.confirm(
      `Revoke device ${device.deviceName ?? truncate(device.credentialId, 10, 6)}? ` +
      `Any active sessions on this device will be killed.`,
    )) return;
    setError(null);
    setBusy(true);
    try {
      await revokeDevice({ userId, credentialId: device.credentialId }, bearer);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-gray-100 px-3 py-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold text-[#0B1F3A]">
          {device.deviceName ?? <span className="font-normal text-gray-500">unnamed device</span>}
        </span>
        <span className="font-mono text-xs text-gray-500">{truncate(device.credentialId, 10, 6)}</span>
        {revoked && (
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
            revoked
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>enrolled {fmtDate(device.enrolledAt)}</span>
        <span>last used {fmtDate(device.lastUsedAt)}</span>
        {revoked && <span>revoked {fmtDate(device.revokedAt)}</span>}
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {!revoked && (
        <button
          type="button"
          onClick={handleRevoke}
          disabled={busy}
          className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Revoking…' : 'Revoke'}
        </button>
      )}
    </li>
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
  sessions, users, loading, callerUid, callerRole, onChanged,
}: {
  sessions: AdminSession[];
  users: AdminUser[];
  loading: boolean;
  callerUid: string;
  callerRole: 'owner' | 'manager' | 'employee';
  onChanged: () => void;
}) {
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
            <SessionRow
              key={s.id}
              session={s}
              owner={users.find((u) => u.userId === s.userId)}
              callerUid={callerUid}
              callerRole={callerRole}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// PFL-130: one active session with an admin kill switch. Visibility
// mirrors the server matrix (owner → any; manager → own or employee
// sessions); the server enforces it regardless.
function SessionRow({
  session: s, owner, callerUid, callerRole, onChanged,
}: {
  session: AdminSession;
  owner: AdminUser | undefined;
  callerUid: string;
  callerRole: 'owner' | 'manager' | 'employee';
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRevoke =
    callerRole === 'owner' ||
    (callerRole === 'manager' && (s.userId === callerUid || owner?.role === 'employee'));

  const who = owner ? (owner.displayName || owner.email) : truncate(s.userId, 12, 6);

  async function handleRevoke() {
    if (!window.confirm(
      `Revoke this signing session for ${who}? ` +
      `Their next silent sign will fail and they'll need to re-authorize with their passkey.`,
    )) return;
    setError(null);
    setBusy(true);
    try {
      await revokeSession(s.id);
      onChanged();
    } catch (err) {
      const msg = err instanceof UserManagementError ? `${err.code}: ${err.message}` :
                  err instanceof Error ? err.message : 'Revoke failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate text-sm font-medium text-[#0B1F3A]">{who}</p>
        <p className="text-xs text-gray-500">
          authorized {fmtDate(s.authorizedAt)} · expires {fmtDate(s.expiresAt)}
        </p>
      </div>
      <p className="mt-0.5 truncate text-sm text-gray-600">
        <span className="text-gray-400">recipient</span>{' '}
        <span className="font-mono text-xs">{truncate(s.recipient, 12, 6)}</span>
        <span className="ml-3 text-gray-400">signs</span>{' '}
        <span className="text-xs">{s.signCount ?? 0}</span>
        {s.lastUsedAt !== null && (
          <>
            <span className="ml-3 text-gray-400">last used</span>{' '}
            <span className="text-xs">{fmtDate(s.lastUsedAt)}</span>
          </>
        )}
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {canRevoke && (
        <button
          type="button"
          onClick={handleRevoke}
          disabled={busy}
          className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Revoking…' : 'Revoke session'}
        </button>
      )}
    </li>
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
