import { useNavigate, useParams } from 'react-router-dom';
import { CosignLayout } from '../components/CosignLayout';
import { ExpiredBanner } from '../components/ExpiredBanner';

export function CosignExpired() {
  const navigate = useNavigate();
  const { messageId = '' } = useParams<{ messageId: string }>();

  return (
    <CosignLayout label="Cosign request">
      <div className="space-y-5">
        <ExpiredBanner detail="Cosign links expire after 30 minutes for security. You can request a fresh link to continue." />

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h1 className="text-base font-semibold text-gray-900">Request a fresh link</h1>
          <p className="mt-2 text-sm text-gray-500">
            We'll re-email the original cosign request with a new, time-limited
            link. Tap the button below and check your inbox.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/cosign/${encodeURIComponent(messageId)}/refresh`)}
            className="mt-4 w-full rounded-xl bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:w-auto"
          >
            Request fresh link
          </button>
        </div>
      </div>
    </CosignLayout>
  );
}
