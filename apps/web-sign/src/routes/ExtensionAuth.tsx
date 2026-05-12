import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { ErrorScreen } from '../components/ErrorScreen';
import { validateOpenerFromWindow } from '../lib/opener-validator';
import { getFirebaseAuth } from '../lib/firebase';
import { requestExtensionAuth } from '../api/client';
import { deliverToOpener } from '../api/postmessage';

// First-time extension auth (TDD §11.4, PFL-061).
//
// URL params: ?extInstallId=<id>&returnOrigin=chrome-extension://<id>
//             &ceremonyId=<uuid>
//
// 1. User clicks "Continue with Google".
// 2. Firebase Auth opens its Google sign-in popup; we get an ID token.
// 3. POST { idToken, extInstallId } → /v1/extension/auth.
// 4. Server returns a 30-day JWS authToken + credentialId.
// 5. Deliver auth_success back to the extension via chrome.runtime.

type Phase =
  | { kind: 'opener-error'; reason: string }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating' }
  | { kind: 'authenticated' }
  | { kind: 'error'; detail: string };

interface AuthParams {
  ceremonyId: string;
  extInstallId: string;
  returnOrigin: string;
}

function parseParams(search: string): AuthParams | null {
  const p = new URLSearchParams(search);
  const ids = ['ceremonyId', 'extInstallId', 'returnOrigin'] as const;
  for (const k of ids) if (!p.get(k)) return null;
  return {
    ceremonyId:   p.get('ceremonyId')!,
    extInstallId: p.get('extInstallId')!,
    returnOrigin: p.get('returnOrigin')!,
  };
}

export function ExtensionAuth() {
  const [phase, setPhase] = useState<Phase>({ kind: 'unauthenticated' });
  const [params, setParams] = useState<AuthParams | null>(null);

  useEffect(() => {
    const parsed = parseParams(window.location.search);
    if (!parsed) {
      setPhase({ kind: 'opener-error', reason: 'missing-params' });
      return;
    }
    const opener = validateOpenerFromWindow(window, window.location.search);
    if (!opener.ok) {
      setPhase({ kind: 'opener-error', reason: opener.reason });
      return;
    }
    setParams(parsed);
  }, []);

  async function authenticate(): Promise<void> {
    if (!params) return;
    setPhase({ kind: 'authenticating' });
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      const idToken = await credential.user.getIdToken();

      const resp = await requestExtensionAuth({
        idToken,
        extInstallId: params.extInstallId,
      });

      const delivery = await deliverToOpener(
        {
          kind: 'auth_success',
          ceremonyId: params.ceremonyId,
          authToken: resp.authToken,
          userId:    resp.userId,
          companyId: resp.companyId,
        },
        { extInstallId: params.extInstallId, returnOrigin: params.returnOrigin },
      );
      if (!delivery.delivered) {
        setPhase({ kind: 'error', detail: `Could not return token to extension: ${delivery.reason ?? 'unknown'}` });
        return;
      }
      setPhase({ kind: 'authenticated' });
      setTimeout(() => window.close(), 5_000);
    } catch (e) {
      setPhase({ kind: 'error', detail: e instanceof Error ? e.message : 'Authentication failed.' });
    }
  }

  if (phase.kind === 'opener-error') {
    return <ErrorScreen title="Page must be opened by the ProofLine extension" code={phase.reason} />;
  }
  if (phase.kind === 'error') {
    return (
      <ErrorScreen
        title="Could not connect"
        detail={phase.detail}
        onRetry={() => window.location.reload()}
        onCancel={() => window.close()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-10 sm:py-14 space-y-6">
        <ProofLineLogo size="sm" />
        {phase.kind === 'authenticated' ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <h1 className="text-2xl font-semibold text-[#0B1F3A]">ProofLine connected</h1>
            <p className="text-base text-gray-600">
              You can return to Gmail. The extension will sign emails when you click Send.
            </p>
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px] w-full"
            >
              Return to Gmail
            </button>
            <p className="text-xs text-gray-500">This window closes automatically in 5 seconds.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <header className="space-y-2">
              <h1 className="text-2xl font-semibold text-[#0B1F3A]">Connect ProofLine to Gmail</h1>
              <p className="text-base text-gray-600">
                Sign in with Google to authorize the extension. We'll issue a token your
                browser stores for 30 days. No password — your Google account identifies you.
              </p>
            </header>
            <button
              type="button"
              onClick={() => void authenticate()}
              disabled={phase.kind === 'authenticating'}
              className="rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 min-h-[48px] w-full inline-flex items-center justify-center gap-2"
            >
              {phase.kind === 'authenticating' && (
                <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{phase.kind === 'authenticating' ? 'Authenticating…' : 'Continue with Google'}</span>
            </button>
            <p className="text-xs text-gray-500">
              Your Google ID token is exchanged server-side for a ProofLine extension
              token. We do not see your Google password.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
