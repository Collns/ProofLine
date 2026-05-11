import { useEffect, useState } from 'react';
import type { EmailPayload } from '@proofline/types';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { ErrorScreen } from '../components/ErrorScreen';
import { validateOpenerFromWindow } from '../lib/opener-validator';
import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '../lib/webauthn-bridge';
import { signSilent, signFinalize, setExtensionToken } from '../api/client';
import { ApiError } from '../api/types';
import { deliverToOpener, type CeremonyResponse } from '../api/postmessage';

// Silent ceremony — uses an existing session token. The extension opens
// this in a minimized window. Visually minimal: just a spinner. Only
// renders full UI if something forces visibility (session-invalid mid-flow,
// device error, etc.).
//
// URL params (same as fresh, plus sessionToken):
//   ?kind=silent
//   &sessionToken=<jws>
//   ...rest matches SignStart

interface SilentParams {
  ceremonyId: string;
  extInstallId: string;
  returnOrigin: string;
  recipientSetHash: string;
  payloadHash: string;
  payloadB64: string;
  credentialId: string;
  extToken: string;
  sessionToken: string;
}

function parseParams(search: string): SilentParams | null {
  const p = new URLSearchParams(search);
  const required = [
    'ceremonyId', 'extInstallId', 'returnOrigin',
    'recipientSetHash', 'payloadHash', 'payloadB64',
    'credentialId', 'extToken', 'sessionToken',
  ] as const;
  for (const k of required) {
    if (!p.get(k)) return null;
  }
  return {
    ceremonyId:       p.get('ceremonyId')!,
    extInstallId:     p.get('extInstallId')!,
    returnOrigin:     p.get('returnOrigin')!,
    recipientSetHash: p.get('recipientSetHash')!,
    payloadHash:      p.get('payloadHash')!,
    payloadB64:       p.get('payloadB64')!,
    credentialId:     p.get('credentialId')!,
    extToken:         p.get('extToken')!,
    sessionToken:     p.get('sessionToken')!,
  };
}

function decodeBase64UrlJson<T>(b64u: string): T {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(padded)))) as T;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(hashBuffer);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += arr[i]!.toString(16).padStart(2, '0');
  return out;
}

type Phase =
  | { kind: 'running' }
  | { kind: 'opener-error'; reason: string }
  | { kind: 'session-invalid'; code: string; detail: string }
  | { kind: 'device-error'; code: string; detail: string }
  | { kind: 'success' };

export function SignSilent() {
  const [phase, setPhase] = useState<Phase>({ kind: 'running' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = parseParams(window.location.search);
      if (!params) {
        setPhase({ kind: 'opener-error', reason: 'missing-params' });
        return;
      }
      const opener = validateOpenerFromWindow(window, window.location.search);
      if (!opener.ok) {
        setPhase({ kind: 'opener-error', reason: opener.reason });
        return;
      }

      let payload: EmailPayload;
      try {
        payload = decodeBase64UrlJson<EmailPayload>(params.payloadB64);
      } catch {
        setPhase({ kind: 'session-invalid', code: 'PAYLOAD_DECODE', detail: 'Could not decode payload.' });
        return;
      }
      const localHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
      if (localHash !== params.payloadHash) {
        setPhase({ kind: 'session-invalid', code: 'PAYLOAD_HASH_MISMATCH', detail: 'Payload tamper check failed.' });
        return;
      }

      setExtensionToken(params.extToken);

      // Re-validate session + re-issue challenge.
      let serverChallenge: string;
      try {
        const resp = await signSilent({
          sessionToken:     params.sessionToken,
          payload,
          recipientSetHash: params.recipientSetHash,
          credentialId:     params.credentialId,
        });
        if (!resp.ok) {
          if (cancelled) return;
          await deliverToOpener(
            { kind: 'error', ceremonyId: params.ceremonyId, code: resp.error, message: 'Session no longer valid.' },
            { extInstallId: params.extInstallId, returnOrigin: params.returnOrigin },
          );
          setPhase({
            kind: 'session-invalid',
            code: resp.error,
            detail: 'Your signing session is no longer valid. Send the message again to start a new session.',
          });
          return;
        }
        serverChallenge = resp.challenge.challenge;
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : null;
        await deliverToOpener(
          {
            kind: 'error',
            ceremonyId: params.ceremonyId,
            code: err?.code ?? 'NETWORK',
            message: err?.message ?? 'Server unreachable.',
          },
          { extInstallId: params.extInstallId, returnOrigin: params.returnOrigin },
        );
        setPhase({
          kind: 'session-invalid',
          code: err?.code ?? 'NETWORK',
          detail: err?.message ?? 'Could not reach the signing server.',
        });
        return;
      }

      // userVerification: 'discouraged' — OS treats recent UV as valid; no
      // biometric prompt typically. The assertion is still produced and
      // server-verified.
      try {
        const assertion = await startAssertionCeremony({
          challenge: serverChallenge,
          rpId: 'proofline-sign.web.app',
          allowCredentials: [{ type: 'public-key', id: params.credentialId }],
          userVerification: 'discouraged',
          timeout: 30_000,
        });

        const finalize = await signFinalize(
          {
            assertion: {
              credentialId:      assertion.id,
              clientDataJSON:    assertion.response.clientDataJSON,
              authenticatorData: assertion.response.authenticatorData,
              signature:         assertion.response.signature,
              userHandle:        assertion.response.userHandle ?? undefined,
            },
            payloadHash:      localHash,
            recipientSetHash: params.recipientSetHash,
            path:             'silent',
            sessionToken:     params.sessionToken,
          },
          params.ceremonyId,
        );

        if (!finalize.ok) {
          await deliverToOpener(
            { kind: 'error', ceremonyId: params.ceremonyId, code: finalize.error, message: 'Server rejected the assertion.' },
            { extInstallId: params.extInstallId, returnOrigin: params.returnOrigin },
          );
          setPhase({ kind: 'session-invalid', code: finalize.error, detail: 'Server rejected the signature.' });
          return;
        }

        await deliverToOpener(
          {
            kind: 'sign_success',
            ceremonyId:   params.ceremonyId,
            envelope:     finalize.envelope,
            banner:       finalize.banner,
            sessionToken: finalize.sessionToken,
          },
          { extInstallId: params.extInstallId, returnOrigin: params.returnOrigin },
        );
        setPhase({ kind: 'success' });
        setTimeout(() => window.close(), 100);
      } catch (e) {
        const ceremonyResp: CeremonyResponse =
          e instanceof UserCancelled || e instanceof WebAuthnAbortError
            ? { kind: 'user_cancelled', ceremonyId: params.ceremonyId }
            : {
                kind: 'error',
                ceremonyId: params.ceremonyId,
                code: e instanceof DeviceUnsupported ? 'DEVICE_UNSUPPORTED' : 'INTERNAL_ERROR',
                message: e instanceof Error ? e.message : 'Unexpected error.',
              };
        await deliverToOpener(ceremonyResp, {
          extInstallId: params.extInstallId,
          returnOrigin: params.returnOrigin,
        });
        if (e instanceof DeviceUnsupported) {
          setPhase({ kind: 'device-error', code: 'DEVICE_UNSUPPORTED', detail: 'This device does not support passkeys.' });
        } else {
          setPhase({
            kind: 'session-invalid',
            code: e instanceof ApiError ? e.code : 'INTERNAL_ERROR',
            detail: e instanceof Error ? e.message : 'Unexpected error.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.kind === 'opener-error') {
    return <ErrorScreen title="Page must be opened by the ProofLine extension" code={phase.reason} />;
  }
  if (phase.kind === 'session-invalid') {
    return (
      <ErrorScreen
        title="Session expired or invalid"
        detail={phase.detail}
        code={phase.code}
        onCancel={() => window.close()}
        cancelLabel="Close"
      />
    );
  }
  if (phase.kind === 'device-error') {
    return <ErrorScreen title="Device not supported" detail={phase.detail} code={phase.code} />;
  }

  // Default: spinner. The extension opens this minimized; the user usually
  // never sees this state for more than a fraction of a second.
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-sm px-4 py-12 text-center space-y-4" role="status" aria-live="polite">
        <ProofLineLogo size="sm" />
        <div className="flex justify-center">
          <span aria-hidden="true" className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#0D6EFD] border-t-transparent" />
        </div>
        <p className="text-sm text-gray-600">
          {phase.kind === 'success' ? 'Signed.' : 'Signing…'}
        </p>
      </div>
    </div>
  );
}
