import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchVerification } from '../api/client';
import type { VerificationResponse } from '../api/types';
import { VerifyHeader } from '../components/VerifyHeader';
import { VerifyBadge } from '../components/VerifyBadge';
import { PayloadCard } from '../components/PayloadCard';
import { SignerList } from '../components/SignerList';
import { AnchorReceipt } from '../components/AnchorReceipt';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: VerificationResponse };

export function VerifyPage() {
  const { messageId } = useParams<{ messageId: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!messageId) return;
    setState({ status: 'loading' });
    fetchVerification(messageId)
      .then((result) => setState({ status: 'done', result }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load verification';
        setState({ status: 'error', message });
      });
  }, [messageId]);

  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'error') return <ErrorScreen message={state.message} />;

  const { result } = state;
  return <VerifyResult result={result} />;
}

function VerifyResult({ result }: { result: VerificationResponse }) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <ProoflineLogo />
        <VerifyHeader result={result} />

        {result.state === 'verified' && (
          <>
            <PayloadCard payload={result.payload} />
            <SignerList signers={result.signers} />
            <AnchorReceipt anchor={result.anchor} />
          </>
        )}

        {result.state === 'bilateral' && (
          <>
            <PayloadCard payload={result.payload} />
            <SignerList signers={result.signers} />
            <AnchorReceipt anchor={result.anchor} />
          </>
        )}

        {result.state === 'suspected_spoof' && (
          <SpoofWarning domain={result.claimedCompany.domain} />
        )}

        {result.state === 'rejected' && (
          <RejectedDetail code={result.code} detail={result.detail} />
        )}

        {result.state === 'unverified_sender' && (
          <UnverifiedSenderContent />
        )}

        <VerifyFooter />
      </div>
    </div>
  );
}

function SpoofWarning({ domain }: { domain: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[#D93025] bg-red-50 p-4 space-y-3"
    >
      <p className="text-sm font-semibold text-[#D93025]">
        {domain} is a verified ProofLine sender, but this specific message carries no valid ProofLine signature.
      </p>
      <p className="text-sm text-gray-700">
        If you were expecting wire instructions or other sensitive content, contact the sender via a known channel before acting on anything in this message.
      </p>
      <p className="text-sm text-gray-700">
        A valid ProofLine message will always produce a green or emerald verification badge. The absence of a valid signature from a known sender is a strong indicator of a spoofed or forwarded message.
      </p>
      <a
        href="https://proofline.com/learn"
        className="text-sm font-medium text-[#0D6EFD] hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        What is ProofLine?
      </a>
    </div>
  );
}

function RejectedDetail({ code, detail }: { code: string; detail: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-gray-200 bg-white p-4 space-y-3"
    >
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Failure reason
        </p>
        <p className="text-sm font-mono text-[#D93025] bg-red-50 rounded px-2 py-1 inline-block">
          {code}
        </p>
      </div>
      <p className="text-sm text-gray-700">{detail}</p>
      <p className="text-sm text-gray-500">
        If you believe this is an error, contact the sender to request a fresh signed message.
      </p>
    </div>
  );
}

function UnverifiedSenderContent() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm text-gray-700">
        This is not a sign of fraud — it just means ProofLine has no signature to check for this sender. Use your usual judgment before acting on the message.
      </p>
      <a
        href="https://proofline.com/enroll"
        className="text-sm font-medium text-[#0D6EFD] hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        If you are the sender, learn how to enroll
      </a>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Loading verification"
      className="min-h-screen bg-[#FAFAFA] flex items-center justify-center"
    >
      <div className="text-center space-y-3">
        <div
          aria-hidden="true"
          className="mx-auto w-8 h-8 border-2 border-gray-200 border-t-[#0D6EFD] rounded-full animate-spin"
        />
        <p className="text-sm text-gray-500">Verifying signature...</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4"
    >
      <div className="max-w-md w-full rounded-xl border border-gray-200 bg-white p-6 text-center space-y-3">
        <VerifyBadge state="rejected" size="md" />
        <h1 className="text-lg font-semibold text-gray-900">Could not load verification</h1>
        <p className="text-sm text-gray-600">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[#0B1F3A] text-white hover:bg-[#1a3255] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:ring-offset-2"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function ProoflineLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-md bg-[#0B1F3A] flex items-center justify-center"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 4L7 2L11 4V8L7 12L3 8V4Z" stroke="white" strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M5 7L6.5 8.5L9.5 5.5" stroke="white" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-sm font-semibold text-[#0B1F3A]">ProofLine</span>
    </div>
  );
}

function VerifyFooter() {
  return (
    <footer className="pt-4 border-t border-gray-200">
      <p className="text-xs text-gray-400 text-center">
        ProofLine cryptographic verification — tamper-evident, anchored on Base.
      </p>
    </footer>
  );
}
