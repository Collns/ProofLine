import type { WirePayload } from '@proofline/types';
import { formatUSD, formatRouting, formatAccountMasked } from '../lib/format';

interface WirePayloadCardProps {
  payload: WirePayload;
}

export function WirePayloadCard({ payload }: WirePayloadCardProps) {
  return (
    <section
      aria-label="Wire details"
      className="rounded-2xl border border-gray-200 bg-white shadow-sm"
    >
      <header className="border-b border-gray-200 px-5 py-3">
        <p className="text-xs uppercase tracking-wider text-gray-500">Wire instruction</p>
      </header>

      <div className="px-5 py-5 space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500">Amount</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900 sm:text-4xl">
            {formatUSD(payload.amount)}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6">
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Recipient account</dt>
            <dd className="mt-1 font-mono text-base text-gray-900">
              {formatAccountMasked(payload.recipientAccount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Routing number</dt>
            <dd className="mt-1 font-mono text-base text-gray-900">
              {formatRouting(payload.recipientRouting)}
            </dd>
          </div>
          {payload.reference ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-500">Reference</dt>
              <dd className="mt-1 text-sm text-gray-900">{payload.reference}</dd>
            </div>
          ) : null}
        </dl>

        {payload.memo ? (
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Memo</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{payload.memo}</dd>
          </div>
        ) : null}
      </div>
    </section>
  );
}
