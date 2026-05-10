import type { EmailPayload } from '@proofline/types';
import { formatUSD, truncateHash } from '../lib/format';

interface Props {
  payload: EmailPayload;
  payloadHash: string;
}

// What the user is about to sign. Shows the canonical fields that
// matter — recipients, subject, body, and the wire fields if any —
// plus the payload hash for receipts. The hash is the only thing the
// signature actually covers; everything above is what the user *sees*
// while consenting to that hash.

export function PayloadPreview({ payload, payloadHash }: Props) {
  return (
    <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
      <Row label="From" value={payload.from} mono />
      <Row label="To" value={payload.to.join(', ')} mono wrap />
      {payload.cc.length > 0 && <Row label="Cc" value={payload.cc.join(', ')} mono wrap />}
      <Row label="Subject" value={payload.subject} />
      <Row label="Body">
        <pre className="font-sans whitespace-pre-wrap text-sm text-[#1F2937] max-h-48 overflow-y-auto">
          {payload.body}
        </pre>
      </Row>

      {payload.isWireInstruction && payload.wirePayload && (
        <div className="rounded-md border border-[#B45309]/30 bg-[#B45309]/5 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#B45309]">
            Wire instruction
          </p>
          <Row label="Amount" value={formatUSD(payload.wirePayload.amount)} mono />
          <Row label="Account" value={payload.wirePayload.recipientAccount} mono />
          <Row label="Routing" value={payload.wirePayload.recipientRouting} mono />
          {payload.wirePayload.memo && <Row label="Memo" value={payload.wirePayload.memo} />}
        </div>
      )}

      <div className="border-t border-gray-200 pt-3">
        <Row label="Payload hash">
          <code className="font-mono text-xs text-gray-500" title={payloadHash}>
            {truncateHash(payloadHash, 12)}
          </code>
        </Row>
        <p className="mt-1 text-xs text-gray-500">
          This is the only thing your device signs. Tampering with the message
          changes the hash and breaks the signature.
        </p>
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  value?: string;
  mono?: boolean;
  wrap?: boolean;
  children?: React.ReactNode;
}

function Row({ label, value, mono, wrap, children }: RowProps) {
  return (
    <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[80px_1fr] sm:items-baseline sm:gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children ?? (
        <span
          className={[
            mono ? 'font-mono' : '',
            wrap ? 'break-words' : 'truncate',
            'text-sm text-[#1F2937]',
          ].join(' ')}
        >
          {value ?? '—'}
        </span>
      )}
    </div>
  );
}
