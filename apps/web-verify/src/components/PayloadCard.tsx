import type { WirePayload, EmailPayload, BilateralPayload } from '@proofline/types';
import { formatUSD, formatTimestamp, maskAccount } from '../lib/format';

type Payload = WirePayload | EmailPayload | BilateralPayload;

interface Props {
  payload: Payload;
}

export function PayloadCard({ payload }: Props) {
  if ('amount' in payload) return <WireCard payload={payload} />;
  if ('from' in payload) return <EmailCard payload={payload} />;
  return <BilateralCard payload={payload} />;
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide min-w-[120px] shrink-0">
        {label}
      </dt>
      <dd className={`text-sm text-gray-900 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function WireCard({ payload }: { payload: WirePayload }) {
  return (
    <section aria-label="Wire instruction details" className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Wire Instruction
      </h2>
      <dl className="divide-y-0">
        <Row label="Amount" value={<span className="text-lg font-bold text-[#0B1F3A]">{formatUSD(payload.amount)}</span>} />
        <Row label="Currency" value={payload.currency} />
        <Row label="Recipient Account" value={maskAccount(payload.recipientAccount)} mono />
        <Row label="Routing Number" value={payload.recipientRouting} mono />
        {payload.memo && <Row label="Memo" value={payload.memo} />}
        {payload.reference && <Row label="Reference" value={payload.reference} mono />}
      </dl>
    </section>
  );
}

function EmailCard({ payload }: { payload: EmailPayload }) {
  return (
    <section aria-label="Email details" className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Signed Email
      </h2>
      <dl className="divide-y-0">
        <Row label="From" value={payload.from} mono />
        <Row label="To" value={payload.to.join(', ')} mono />
        {payload.cc.length > 0 && <Row label="CC" value={payload.cc.join(', ')} mono />}
        <Row label="Subject" value={payload.subject} />
        <Row label="Issued" value={formatTimestamp(payload.issuedAt)} />
        <Row label="Expires" value={formatTimestamp(payload.expiresAt)} />
      </dl>
      {payload.body && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-medium text-gray-500 mb-2">Message body</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{payload.body}</p>
        </div>
      )}
      {payload.isWireInstruction && payload.wirePayload && (
        <div className="mt-4">
          <WireCard payload={payload.wirePayload} />
        </div>
      )}
    </section>
  );
}

const DOC_TYPE_LABELS: Record<string, string> = {
  banking_change: 'Banking Change',
  vendor_onboarding: 'Vendor Onboarding',
  payment_terms: 'Payment Terms',
};

function BilateralCard({ payload }: { payload: BilateralPayload }) {
  return (
    <section aria-label="Bilateral document details" className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Bilateral Document
      </h2>
      <dl className="divide-y-0">
        <Row label="Document Type" value={DOC_TYPE_LABELS[payload.docType] ?? payload.docType} />
        <Row label="Document ID" value={payload.docId} mono />
        <Row label="Issued" value={formatTimestamp(payload.issuedAt)} />
        <Row label="Expires" value={formatTimestamp(payload.expiresAt)} />
      </dl>
      {Object.keys(payload.content).length > 0 && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs font-medium text-gray-500 mb-2">Document content</p>
          <dl className="divide-y-0">
            {Object.entries(payload.content).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
