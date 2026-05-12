import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { CosignLayout } from '../components/CosignLayout';
import { ErrorScreen }  from '../components/ErrorScreen';
import { runCosignAssertion } from '../lib/webauthn-bridge';

const API_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL
  ?? 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const BILATERAL_BASE = `${API_BASE}/v1/bilateral`;

const FIXTURE_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('fixture') === 'happy-path';

type Phase = 'loading' | 'review' | 'signing' | 'error';

interface DocSummary {
  docId:    string;
  status:   string;
  docType?: string;
}

export function BilateralLanding() {
  const navigate                  = useNavigate();
  const { docId = '' }            = useParams<{ docId: string }>();
  const [searchParams]            = useSearchParams();
  const token                     = searchParams.get('t') ?? '';
  const counterpartyCompanyId     = searchParams.get('cid') ?? '';
  const counterpartyUserId        = searchParams.get('uid') ?? '';

  const [phase, setPhase]         = useState<Phase>('loading');
  const [doc, setDoc]             = useState<DocSummary | null>(null);
  const [busy, setBusy]           = useState(false);
  const [terminalError, setTerminalError] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    if (!docId || !token) {
      setTerminalError({
        title:  'Invalid link',
        detail: 'This link is missing its security token. Please use the link from the email exactly as sent.',
      });
      setPhase('error');
      return;
    }

    if (FIXTURE_MODE) {
      setDoc({ docId, status: 'PENDING_COUNTERPARTY', docType: 'banking_change' });
      setPhase('review');
      return;
    }

    fetch(`${BILATERAL_BASE}/${encodeURIComponent(docId)}`, {
      headers: { 'X-ProofLine-Bilateral-Token': token },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json() as Promise<DocSummary>;
      })
      .then((data) => {
        if (data.status === 'EXPIRED') {
          navigate(`/b/${encodeURIComponent(docId)}/expired`, { replace: true });
          return;
        }
        if (data.status === 'REVOKED') {
          setTerminalError({ title: 'Document revoked', detail: 'This document has been revoked by the sender.' });
          setPhase('error');
          return;
        }
        if (data.status === 'BILATERAL_SIGNED') {
          navigate(`/b/${encodeURIComponent(docId)}/success`, { replace: true });
          return;
        }
        setDoc(data);
        setPhase('review');
      })
      .catch((err: Error) => {
        setTerminalError({ title: 'Could not load document', detail: err.message });
        setPhase('error');
      });
  }, [docId, token, navigate]);

  async function handleSign(): Promise<void> {
    if (!doc) return;
    setBusy(true);
    setPhase('signing');

    try {
      let assertion: unknown;

      if (FIXTURE_MODE) {
        await new Promise((r) => setTimeout(r, 1200));
        assertion = { id: 'fixture', type: 'public-key', response: {} };
      } else {
        const result = await runCosignAssertion({ challenge: doc.docId });
        if (!result.ok) {
          setTerminalError({
            title:  'Could not capture biometric',
            detail: result.code === 'USER_CANCELLED'
              ? 'You cancelled the biometric prompt. Tap Sign again when ready.'
              : 'Biometric capture failed. Please try again.',
          });
          setPhase('error');
          setBusy(false);
          return;
        }
        assertion = result.assertion;
      }

      const res = await fetch(`${BILATERAL_BASE}/sign-as-counterparty`, {
        method:  'POST',
        headers: {
          'Content-Type':                'application/json',
          'X-ProofLine-Bilateral-Token': token,
        },
        body: JSON.stringify({
          docId,
          sig:       JSON.stringify(assertion),
          companyId: counterpartyCompanyId,
          userId:    counterpartyUserId,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(body?.detail ?? `Server returned ${res.status}`);
      }

      navigate(`/b/${encodeURIComponent(docId)}/success`, { replace: true });
    } catch (err) {
      setTerminalError({ title: 'Signing failed', detail: (err as Error).message });
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'error' && terminalError) {
    return (
      <CosignLayout label="Bilateral document">
        <ErrorScreen title={terminalError.title} detail={terminalError.detail} />
      </CosignLayout>
    );
  }

  if (phase === 'loading') {
    return (
      <CosignLayout label="Bilateral document">
        <p className="text-sm text-gray-500">Loading document…</p>
      </CosignLayout>
    );
  }

  return (
    <CosignLayout label="Review & Sign">
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h1 className="text-base font-semibold text-gray-900">Review document</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review the details below before signing with your passkey.
          </p>
          {doc && (
            <dl className="mt-4 divide-y divide-gray-100 text-sm">
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Document ID</dt>
                <dd className="font-mono text-gray-900 truncate max-w-[180px]">{doc.docId}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Type</dt>
                <dd className="text-gray-900">{doc.docType ?? '—'}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="font-medium text-gray-500">Status</dt>
                <dd className="text-gray-900">{doc.status}</dd>
              </div>
            </dl>
          )}
        </section>

        <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white/95 backdrop-blur-sm sm:static sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none">
          <div className="mx-auto max-w-2xl px-4 py-3 sm:px-0 sm:py-0">
            <button
              type="button"
              onClick={() => void handleSign()}
              disabled={busy || phase === 'signing'}
              className="w-full rounded-xl bg-blue-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
            >
              {busy ? 'Waiting for biometric…' : 'Sign document with Touch ID'}
            </button>
          </div>
        </div>
      </div>
    </CosignLayout>
  );
}