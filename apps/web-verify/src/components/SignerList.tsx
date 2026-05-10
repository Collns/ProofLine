import type { VerifiedSignerInfo } from '@proofline/verification';
import { formatTimestamp } from '../lib/format';

interface Props {
  signers: VerifiedSignerInfo[];
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Employee',
};

export function SignerList({ signers }: Props) {
  return (
    <section aria-label="Signers">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        {signers.length === 1 ? 'Signed by' : `Signed by ${signers.length} parties`}
      </h2>
      <ul className="space-y-3" role="list">
        {signers.map((signer) => (
          <li
            key={signer.credentialId}
            className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#0B1F3A] truncate">
                {signer.userDisplayName}
              </p>
              <p className="text-sm text-gray-600 truncate">
                {signer.companyLegalName}{' '}
                <span className="text-gray-400">({signer.companyDomain})</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Signed {formatTimestamp(signer.signedAt)}
              </p>
            </div>
            <div className="shrink-0">
              <RoleChip role={signer.role} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleChip({ role }: { role: string }) {
  const label = ROLE_LABELS[role] ?? role;
  return (
    <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 border border-gray-200">
      {label}
    </span>
  );
}
