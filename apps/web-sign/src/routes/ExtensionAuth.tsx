import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { ErrorScreen } from '../components/ErrorScreen';
import { validateOpenerFromWindow } from '../lib/opener-validator';
import { getFirebaseAuth } from '../lib/firebase';
import { registerPlatformAuthenticator } from '../lib/webauthn-register';
import {
  requestExtensionAuth,
  registerCredential,
  requestRegistrationChallenge,
} from '../api/client';
import { deliverToOpener } from '../api/postmessage';

// Extension auth + first-device enrolment (PFL-061, PFL-069).
//
// URL params: ?extInstallId=<id>&returnOrigin=chrome-extension://<id>
//             &ceremonyId=<uuid>
//
// 1. User clicks "Continue with Google" → Firebase Auth ID token.
// 2. POST /v1/extension/auth → { authToken, userId, companyId, credentialId, email }.
// 3. If credentialId === PLACEHOLDER: prompt the user to enrol a platform
//    authenticator (Touch ID / Windows Hello) so subsequent /v1/sign*
//    ceremonies have a real credential to find. The popup window is on
//    proofline-sign.web.app, which matches the RP ID — that's why we do
//    the WebAuthn ceremony in THIS window, not the extension.
// 4. POST /v1/extension/register-credential → real credentialId.
// 5. Deliver auth_success to the extension with the real credentialId.

const PLACEHOLDER_CREDENTIAL_ID = 'placeholder-credential-id';

type Phase =
  | { kind: 'opener-error'; reason: string }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating' }
  | { kind: 'needs-registration'; auth: AuthSuccess }
  | { kind: 'registering';         auth: AuthSuccess }
  | { kind: 'authenticated' }
  | { kind: 'error'; detail: string };

interface AuthParams {
  ceremonyId: string;
  extInstallId: string;
  returnOrigin: string;
}

interface AuthSuccess {
  authToken:    string;
  userId:       string;
  companyId:    string;
  email:        string;
  credentialId: string;
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

function isPlaceholder(credentialId: string): boolean {
  return !credentialId || credentialId === PLACEHOLDER_CREDENTIAL_ID;
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

  async function deliverAndClose(
    p: AuthParams,
    auth: AuthSuccess,
  ): Promise<void> {
    const delivery = await deliverToOpener(
      {
        kind:         'auth_success',
        ceremonyId:   p.ceremonyId,
        authToken:    auth.authToken,
        userId:       auth.userId,
        companyId:    auth.companyId,
        email:        auth.email,
        credentialId: auth.credentialId,
      },
      { extInstallId: p.extInstallId, returnOrigin: p.returnOrigin },
    );
    if (!delivery.delivered) {
      setPhase({
        kind:   'error',
        detail: `Could not return token to extension: ${delivery.reason ?? 'unknown'}`,
      });
      return;
    }
    setPhase({ kind: 'authenticated' });
    setTimeout(() => window.close(), 5_000);
  }

  async function authenticate(): Promise<void> {
    if (!params) return;
    setPhase({ kind: 'authenticating' });
    try {
      const provider   = new GoogleAuthProvider();
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      const idToken    = await credential.user.getIdToken();

      const resp = await requestExtensionAuth({
        idToken,
        extInstallId: params.extInstallId,
      });

      const auth: AuthSuccess = {
        authToken:    resp.authToken,
        userId:       resp.userId,
        companyId:    resp.companyId,
        email:        resp.email,
        credentialId: resp.credentialId,
      };

      if (isPlaceholder(resp.credentialId)) {
        setPhase({ kind: 'needs-registration', auth });
        return;
      }
      await deliverAndClose(params, auth);
    } catch (e) {
      setPhase({ kind: 'error', detail: e instanceof Error ? e.message : 'Authentication failed.' });
    }
  }

  async function registerDevice(auth: AuthSuccess): Promise<void> {
    if (!params) return;
    setPhase({ kind: 'registering', auth });
    try {
      // PFL-095: fetch a server-issued challenge BEFORE running the
      // WebAuthn ceremony. The same bytes surface in clientDataJSON,
      // and the server consumes the pending_challenges record when
      // /v1/extension/register-credential runs below.
      const challengeResponse = await requestRegistrationChallenge({}, auth.authToken);
      const reg = await registerPlatformAuthenticator({
        userId:       auth.userId,
        email:        auth.email,
        challengeB64: challengeResponse.challenge,
      });
      const stored = await registerCredential(
        {
          credentialId:      reg.credentialId,
          publicKey:         reg.publicKey,
          attestationObject: reg.attestationObject,
          clientDataJSON:    reg.clientDataJSON,
          deviceName:        guessDeviceName(),
        },
        auth.authToken,
      );
      await deliverAndClose(params, { ...auth, credentialId: stored.credentialId });
    } catch (e) {
      // The auth itself succeeded — we don't want to lose the token if the
      // user cancels Touch ID. Deliver auth_success anyway so the extension
      // stays usable; subsequent sign ceremonies will prompt for enrolment.
      // eslint-disable-next-line no-console
      console.warn('[ExtensionAuth] registration failed, delivering auth without credential', e);
      await deliverAndClose(params, auth);
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
        ) : phase.kind === 'needs-registration' || phase.kind === 'registering' ? (
          <div className="space-y-4">
            <header className="space-y-2">
              <h1 className="text-2xl font-semibold text-[#0B1F3A]">Almost done — register your device</h1>
              <p className="text-base text-gray-600">
                Your browser will ask you to confirm with Touch ID, Windows Hello, or your
                fingerprint. This creates the passkey ProofLine uses to sign each email.
              </p>
            </header>
            <button
              type="button"
              onClick={() => void registerDevice(phase.auth)}
              disabled={phase.kind === 'registering'}
              className="rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 min-h-[48px] w-full inline-flex items-center justify-center gap-2"
            >
              {phase.kind === 'registering' && (
                <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{phase.kind === 'registering' ? 'Waiting for device…' : 'Register with Touch ID'}</span>
            </button>
            <p className="text-xs text-gray-500">
              You can skip and ProofLine will ask again on first send. Skipping leaves auth
              connected but signing requires this step.
            </p>
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

function guessDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  if (/Mac/.test(ua))     return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/iPhone/.test(ua))  return 'iPhone';
  if (/iPad/.test(ua))    return 'iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Linux/.test(ua))   return 'Linux';
  return 'Unknown device';
}
