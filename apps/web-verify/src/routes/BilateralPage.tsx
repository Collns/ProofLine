import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchVerification } from '../api/client';
import type { VerificationResponse } from '../api/types';
import { VerifyHeader } from '../components/VerifyHeader';
import { PayloadCard } from '../components/PayloadCard';
import { SignerList } from '../components/SignerList';
import { AnchorReceipt } from '../components/AnchorReceipt';
import { VerifyBadge } from '../components/VerifyBadge';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: VerificationResponse };

export function BilateralPage() {
  const { docId } = useParams<{ docId: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!docId) return;
    setState({ status: 'loading' });
    fetchVerification(docId)
      .then((result) => setState({ status: 'done', result }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load verification';
        setState({ status: 'error', message });
      });
  }, [docId]);

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label="Loading bilateral document"
        className="min-h-screen bg-[#FAFAFA] flex items-center justify-center"
      >
        <div className="text-center space-y-3">
          <div
            aria-hidden="true"
            className="mx-auto w-8 h-8 border-2 border-gray-200 border-t-[#047857] rounded-full animate-spin"
          />
          <p className="text-sm text-gray-500">Loading bilateral document...</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        role="alert"
        className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4"
      >
        <div className="max-w-md w-full rounded-xl border border-gray-200 bg-white p-6 text-center space-y-3">
          <VerifyBadge state="rejected" />
          <h1 className="text-lg font-semibold text-gray-900">Could not load document</h1>
          <p className="text-sm text-gray-600">{state.message}</p>
        </div>
      </div>
    );
  }

  const { result } = state;

  if (result.state !== 'bilateral') {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
          <BilateralLogo />
          <VerifyHeader result={result} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <BilateralLogo />
        <VerifyHeader result={result} />
        <PayloadCard payload={result.payload} />
        <SignerList signers={result.signers} />
        <AnchorReceipt anchor={result.anchor} />
        <footer className="pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center">
            ProofLine bilateral verification — both parties signed the same canonical document.
          </p>
        </footer>
      </div>
    </div>
  );
}

function BilateralLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-md bg-[#047857] flex items-center justify-center"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 4L7 2L11 4V8L7 12L3 8V4Z" stroke="white" strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M5 7L6.5 8.5L9.5 5.5" stroke="white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-sm font-semibold text-[#0B1F3A]">ProofLine</span>
      <span className="text-xs text-gray-400">/ Bilateral</span>
    </div>
  );
}
