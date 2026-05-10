import type { CosignSignerInfo } from '../api/types';
import { formatTimeAgo } from '../lib/format';

interface SignerInfoCardProps {
  signer: CosignSignerInfo;
}

export function SignerInfoCard({ signer }: SignerInfoCardProps) {
  return (
    <section
      aria-label="Original signer"
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <p className="text-xs uppercase tracking-wider text-gray-500">First signed by</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">
        {signer.userDisplayName}
      </p>
      <p className="mt-0.5 text-sm text-gray-500">
        {signer.companyLegalName} · {signer.companyDomain}
      </p>
      <p className="mt-2 text-xs text-gray-500">
        Signed {formatTimeAgo(signer.signedAt)}
      </p>
    </section>
  );
}
