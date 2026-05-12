import { useParams } from 'react-router-dom';
import { CosignLayout } from '../components/CosignLayout';

export function BilateralSuccess() {
  const { docId = '' } = useParams<{ docId: string }>();

  return (
    <CosignLayout label="Document signed">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white text-3xl">
          ✓
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Document signed</h1>
        <p className="mt-2 text-sm text-gray-500">
          Both parties have signed. The document is now bilaterally verified
          and will be anchored on-chain shortly.
        </p>
        <p className="mt-4 font-mono text-xs text-gray-400">{docId}</p>
        <p className="mt-6 text-xs text-gray-500">You can close this window.</p>
      </div>
    </CosignLayout>
  );
}