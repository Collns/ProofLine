// PFL-188: company signing policy — owner/manager only.
//
// Sets the per-company policy for UNSIGNED outbound email. Wires are always
// blocked unsigned regardless of this setting. The server enforces owner/
// manager; this page also hides the controls for employees.
import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { fetchCompanyProfile, fetchUsers } from '../lib/admin-data';
import {
  updateUnsignedPolicy,
  UserManagementError,
  type UnsignedPolicyMode,
} from '../api/user-management-client';

function resolveCompanyId(): string {
  if (typeof window !== 'undefined') {
    const fromParam = new URLSearchParams(window.location.search).get('cid');
    if (fromParam?.trim()) return fromParam.trim();
    const fromStorage = window.localStorage.getItem('proofline-company-id');
    if (fromStorage?.trim()) return fromStorage.trim();
  }
  return '';
}

const MODE_COPY: Record<UnsignedPolicyMode, { title: string; blurb: string }> = {
  block: {
    title: 'Require signing (recommended)',
    blurb: 'Every outgoing email must be signed with ProofLine. Sending an unsigned email is blocked. Wires are always blocked unsigned.',
  },
  warn: {
    title: 'Warn before sending unsigned',
    blurb: 'People can send an unsigned email after a one-click “Send without signing?” confirmation. Wires are still always blocked unsigned.',
  },
  allow: {
    title: 'Allow unsigned email',
    blurb: 'Plain emails send normally; signing is optional. Wires are still always blocked unsigned.',
  },
};

export function SettingsPage() {
  const { user } = useAuth();
  const cid = resolveCompanyId();

  const [loading, setLoading] = useState(true);
  const [callerRole, setCallerRole] = useState<string>('employee');
  const [mode, setMode] = useState<UnsignedPolicyMode>('block');
  const [allowOverride, setAllowOverride] = useState(true);
  const [appendFooter, setAppendFooter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ code: string; detail: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profile, users] = await Promise.all([fetchCompanyProfile(cid), fetchUsers(cid)]);
        if (cancelled) return;
        const policy = profile?.unsignedEmailPolicy;
        if (!policy) {
          // PFL-190 #8: fail safe — if we couldn't load the stored policy, do
          // NOT present an editable default (which a Save would silently push
          // over the real setting). Make the admin reload first.
          setLoadError("Couldn't load your company's current signing policy. Reload before changing it.");
        } else {
          setMode(policy.mode);
          setAllowOverride(policy.allowUnsignedOverride);
          setAppendFooter(policy.appendUnsignedFooter !== false);
        }
        const uid = user?.uid ?? '';
        setCallerRole(users.find((u) => u.userId === uid)?.role ?? 'employee');
      } catch {
        if (!cancelled) setLoadError("Couldn't load your company's current signing policy. Reload before changing it.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cid, user?.uid]);

  const canEdit = callerRole === 'owner' || callerRole === 'manager';

  async function save(): Promise<void> {
    setBusy(true); setSaved(false); setError(null);
    try {
      await updateUnsignedPolicy(mode, allowOverride, appendFooter);
      setSaved(true);
    } catch (e) {
      const err = e instanceof UserManagementError ? e : null;
      setError({ code: err?.code ?? 'UNKNOWN', detail: err?.message ?? 'Could not save the policy.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      eyebrow="Settings"
      heading="Signing policy"
      description="Control whether people at your company can send email without a ProofLine signature. Wire instructions are always blocked unless signed, regardless of this setting."
    >
      {loading ? (
        <p className="text-sm text-gray-500">Loading the current policy…</p>
      ) : loadError ? (
        <div role="alert" className="max-w-xl rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-sm text-[#B3261E]">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-md border border-[#B3261E] px-3 py-1.5 text-sm font-medium text-[#B3261E]"
          >
            Reload
          </button>
        </div>
      ) : !canEdit ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Only an owner or manager can change the signing policy. The current policy is{' '}
          <span className="font-medium">{MODE_COPY[mode].title}</span>.
        </p>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void save(); }}
          className="max-w-xl space-y-5"
          noValidate
        >
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-gray-700">Unsigned email</legend>
            {(['block', 'warn', 'allow'] as UnsignedPolicyMode[]).map((m) => (
              <label key={m} className="flex cursor-pointer gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => { setMode(m); setSaved(false); }}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{MODE_COPY[m].title}</span>
                  <span className="block text-sm text-gray-500">{MODE_COPY[m].blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className={`flex items-start gap-2 text-sm ${mode === 'block' ? 'text-gray-700' : 'text-gray-400'}`}>
            <input
              type="checkbox"
              checked={allowOverride}
              disabled={mode !== 'block'}
              onChange={(e) => { setAllowOverride(e.currentTarget.checked); setSaved(false); }}
              className="mt-0.5"
            />
            <span>
              Allow a “Send unsigned” override in block mode.
              <span className="block text-xs text-gray-400">
                When off, there is no way to send an unsigned email in block mode — people must sign. (Wires never have an override.)
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={appendFooter}
              onChange={(e) => { setAppendFooter(e.currentTarget.checked); setSaved(false); }}
              className="mt-0.5"
            />
            <span>
              Add a footer to unsigned emails.
              <span className="block text-xs text-gray-400">
                When on, emails sent without a ProofLine signature get a small line for the recipient: “This email was sent without a ProofLine signature.” It is never added to signed emails or inside quoted reply text.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-[#B3261E]">{error.detail} ({error.code})</p>
          )}
          {saved && <p className="text-sm text-[#0F9D58]">Saved.</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[#0D6EFD] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save policy'}
          </button>
        </form>
      )}
    </AppShell>
  );
}
