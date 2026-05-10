import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { CosignLayout } from '../components/CosignLayout';
import { ErrorScreen } from '../components/ErrorScreen';
import { requestFreshLink } from '../api/client';

export function CosignFreshLink() {
  const { messageId = '' } = useParams<{ messageId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') ?? '';

  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState('');

  async function handleClick() {
    setState('sending');
    const res = await requestFreshLink({ messageId, token });
    if (res.ok) {
      setState('sent');
    } else {
      setState('error');
      setErrorDetail(res.detail);
    }
  }

  return (
    <CosignLayout label="Fresh cosign link">
      {state === 'sent' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white text-2xl">
            ✓
          </div>
          <h1 className="mt-4 text-lg font-semibold text-gray-900">Fresh link sent</h1>
          <p className="mt-2 text-sm text-gray-500">
            Check the inbox of the original cosign request. The new link will work
            for the next 30 minutes.
          </p>
        </div>
      ) : state === 'error' ? (
        <ErrorScreen
          title="Could not send fresh link"
          detail={errorDetail || 'Unknown error'}
          cta={{ label: 'Try again', onClick: () => setState('idle') }}
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Request a fresh link</h1>
          <p className="mt-2 text-sm text-gray-500">
            We'll re-issue a cosign link tied to the original message and email it
            to the same approver. The old link will be invalidated.
          </p>
          <button
            type="button"
            disabled={state === 'sending'}
            onClick={handleClick}
            className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 sm:w-auto"
          >
            {state === 'sending' ? 'Sending…' : 'Send fresh link'}
          </button>
        </div>
      )}
    </CosignLayout>
  );
}
