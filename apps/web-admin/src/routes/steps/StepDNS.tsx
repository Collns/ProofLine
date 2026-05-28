import { useEffect, useRef, useState } from 'react';
import { CopyableCode } from '../../components/CopyableCode';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SkipDemoButton } from '../../components/SkipDemoButton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LoadingDots } from '../../components/LoadingDots';
import { verifyDns } from '../../api/client';
import { ApiError } from '../../api/types';
import { formatTime } from '../../lib/format';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onMarkVerified: (at: number) => void;
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const POLL_MS = 30_000;
const TROUBLESHOOT_AFTER_MS = 5 * 60 * 1000;

export function StepDNS({ state, onMarkVerified, onAdvance, onBack, onSkip }: Props) {
  const [busy, setBusy] = useState(false);
  const [hasStartedPolling, setHasStartedPolling] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [firstCheckedAt, setFirstCheckedAt] = useState<number | null>(null);
  const [resolverDetail, setResolverDetail] = useState<string | null>(null);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [apiErr, setApiErr] = useState<{ code: string; message: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If state is already verified (e.g. user came back), short-circuit.
  useEffect(() => {
    if (state.dnsVerifiedAt) onAdvance();
    // We only want this to run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check(): Promise<void> {
    if (!state.companyId) return;
    setBusy(true);
    setApiErr(null);
    try {
      const res = await verifyDns({ companyId: state.companyId });
      const now = Date.now();
      setLastChecked(now);
      setResolverDetail(res.resolvers);
      if (firstCheckedAt === null) setFirstCheckedAt(now);
      if (res.ok) {
        onMarkVerified(now);
        onAdvance();
        return;
      }
      if (firstCheckedAt && now - firstCheckedAt > TROUBLESHOOT_AFTER_MS) {
        setShowTroubleshoot(true);
      }
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setApiErr({
        code:    e?.code ?? 'UNKNOWN',
        message: e?.message ?? 'DNS check failed. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  function startPolling(): void {
    if (hasStartedPolling) return;
    setHasStartedPolling(true);
    void check(); // immediate
    pollRef.current = setInterval(() => { void check(); }, POLL_MS);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!state.dnsToken || !state.txtHost || !state.txtRecord) {
    return (
      <section className="space-y-4">
        <p className="text-base text-gray-600">
          Missing DNS challenge. Go back and submit your company info.
        </p>
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="dns-heading">
      <header className="space-y-2">
        <h1 id="dns-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Prove you control {state.domain}
        </h1>
        <p className="text-base text-gray-600">
          Add this TXT record to your DNS. We'll detect it automatically — usually within
          a few minutes, sometimes longer.
        </p>
      </header>

      {apiErr && (
        <ErrorBanner code={apiErr.code} message={apiErr.message} onDismiss={() => setApiErr(null)} />
      )}

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[80px_1fr] sm:items-center">
          <span className="text-gray-500">Type</span>
          <code className="font-mono text-[#1F2937]">TXT</code>

          <span className="text-gray-500">Host</span>
          <CopyableCode value={state.txtHost} />

          <span className="text-gray-500">Value</span>
          <CopyableCode value={state.txtRecord} />
        </div>
        <p className="text-xs text-gray-500">
          DNS propagation can take a few minutes. Some providers cache TXT records up to an hour.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <RegistrarLink href="https://dash.cloudflare.com">Add to Cloudflare</RegistrarLink>
        <RegistrarLink href="https://ap.www.namecheap.com/Domains/DomainControlPanel">
          Add to Namecheap
        </RegistrarLink>
        <RegistrarLink href="https://dcc.godaddy.com/manage/dns">Add to GoDaddy</RegistrarLink>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
        {!hasStartedPolling ? (
          <>
            <p className="text-sm text-gray-600">
              When you've added the TXT record, click the button below. We'll start checking
              every 30 seconds.
            </p>
            <PrimaryButton onClick={() => startPolling()} loading={busy}>
              I've added it — check now
            </PrimaryButton>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              {busy ? (
                <LoadingDots label="Checking 3 DNS resolvers…" />
              ) : (
                <p className="text-sm text-gray-600">
                  {lastChecked
                    ? `Last checked: ${formatTime(lastChecked)}`
                    : 'Waiting for first check…'}
                </p>
              )}
              <SecondaryButton onClick={() => void check()} disabled={busy}>
                Re-check now
              </SecondaryButton>
            </div>
            {resolverDetail && (
              <p className="font-mono text-xs text-gray-500 break-all">{resolverDetail}</p>
            )}
            {showTroubleshoot && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-[#B45309]">
                <p className="font-semibold">Still not seeing it?</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>DNS propagation can take up to 60 minutes.</li>
                  <li>Confirm the host is exactly <code className="font-mono">{state.txtHost}</code> with no trailing dot.</li>
                  <li>Confirm the value is <code className="font-mono">{state.txtRecord}</code> with no surrounding quotes added by your provider.</li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex justify-between">
        <SecondaryButton onClick={onBack} disabled={busy}>Back</SecondaryButton>
      </div>

      <SkipDemoButton onClick={onSkip} />
    </section>
  );
}

function RegistrarLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-[#0B1F3A] transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2"
    >
      {children}
    </a>
  );
}
