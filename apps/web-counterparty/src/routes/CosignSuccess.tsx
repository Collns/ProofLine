import { Link, useParams } from 'react-router-dom';
import { CosignLayout } from '../components/CosignLayout';

export function CosignSuccess() {
  const { messageId = '' } = useParams<{ messageId: string }>();
  return (
    <CosignLayout label="Cosign complete">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white text-3xl">
          ✓
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Cosign complete</h1>
        <p className="mt-2 text-sm text-gray-500">
          The wire is now bilaterally signed and is being recorded on-chain.
        </p>

        <div className="mt-6 space-y-3 text-sm">
          <Link
            to={`/v/${encodeURIComponent(messageId)}`}
            className="inline-block rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-gray-900 hover:bg-gray-50"
          >
            View full verification
          </Link>
        </div>

        <p className="mt-6 text-xs text-gray-500">You can close this window.</p>
      </div>
    </CosignLayout>
  );
}
