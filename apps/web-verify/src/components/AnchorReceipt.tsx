import type { SerializedAnchor } from '../api/types';
import { buildBasescanBlockUrl } from '../lib/basescan';
import { truncateHash, formatTimestamp } from '../lib/format';

interface Props {
  anchor: SerializedAnchor;
  txHash?: string | null;
}

export function AnchorReceipt({ anchor, txHash }: Props) {
  const blockUrl = buildBasescanBlockUrl(anchor.blockNumber);
  const anchoredAt = formatTimestamp(Number(anchor.timestamp));

  return (
    <section aria-label="Blockchain anchor receipt" className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Blockchain Anchor
      </h2>
      <dl className="space-y-0">
        <AnchorRow label="Anchored at" value={anchoredAt} />
        <AnchorRow
          label="Block"
          value={
            <a
              href={blockUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0D6EFD] hover:underline font-mono"
              aria-label={`View block ${anchor.blockNumber} on Basescan`}
            >
              #{anchor.blockNumber}
            </a>
          }
        />
        <AnchorRow
          label="Anchor root"
          value={
            <span className="font-mono text-xs break-all text-gray-700">
              {truncateHash(anchor.root, 12)}
            </span>
          }
        />
        {txHash && (
          <AnchorRow
            label="Tx hash"
            value={
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0D6EFD] hover:underline font-mono text-xs break-all"
                aria-label="View transaction on Basescan"
              >
                {truncateHash(txHash, 10)}
              </a>
            }
          />
        )}
      </dl>
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Anchored on{' '}
          <a
            href="https://base.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0D6EFD] hover:underline"
          >
            Base Sepolia
          </a>{' '}
          — tamper-evident proof this message existed at anchor time.
        </p>
      </div>
    </section>
  );
}

function AnchorRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-4 py-2 border-b border-gray-100 last:border-0">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide min-w-[100px] shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}
