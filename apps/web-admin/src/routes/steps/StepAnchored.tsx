import { PrimaryButton } from '../../components/PrimaryButton';
import { formatTimestamp, truncateHash } from '../../lib/format';
import type { WizardState } from '../../state/wizard-store';

interface Props {
  state: WizardState;
  onAdvance: () => void;
}

export function StepAnchored({ state, onAdvance }: Props) {
  const txHash = state.anchorTxHash;
  const blockNumber = state.anchorBlockNumber;
  const verifiedAt = state.verifiedAt;
  const basescanUrl = txHash ? `https://sepolia.basescan.org/tx/${txHash}` : null;

  return (
    <section className="space-y-6" aria-labelledby="anchored-heading">
      <header className="space-y-3">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#0F9D58]/10"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-6 w-6 text-[#0F9D58]">
            <path
              d="M5 10.5l3 3 7-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 id="anchored-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          You're verified
        </h1>
        <p className="text-base leading-relaxed text-gray-600">
          Your company is now part of the ProofLine network. This verification is
          anchored on Base Sepolia and provable forever.
        </p>
      </header>

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        <Row label="Domain"           value={state.domain || '—'} mono />
        <Row label="Legal name"       value={state.legalName || '—'} />
        {txHash ? (
          <Row label="Anchor tx" mono value={
            <a
              href={basescanUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0D6EFD] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded"
            >
              {truncateHash(txHash, 8)}
            </a>
          } />
        ) : (
          <Row
            label="Anchor tx"
            value={
              <span className="text-[#B45309]">
                queued — will retry via batch
              </span>
            }
          />
        )}
        {blockNumber && <Row label="Block"        value={blockNumber} mono />}
        {verifiedAt && <Row label="Anchored at"  value={formatTimestamp(verifiedAt)} />}
      </div>

      <PrimaryButton onClick={onAdvance}>Install the extension</PrimaryButton>
    </section>
  );
}

function Row({ label, value, mono }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500 sm:w-24">
        {label}
      </span>
      <span className={mono ? 'font-mono text-sm text-[#1F2937]' : 'text-sm text-[#1F2937]'}>
        {value}
      </span>
    </div>
  );
}
