import { useEffect, useMemo, useState } from 'react';
import type { EmailPayload } from '@proofline/types';
import { ProofLineLogo } from '../components/ProofLineLogo';
import { PayloadPreview } from '../components/PayloadPreview';
import { BiometricButton } from '../components/BiometricButton';
import { SessionInfo } from '../components/SessionInfo';
import { ErrorScreen } from '../components/ErrorScreen';
import { validateOpenerFromWindow } from '../lib/opener-validator';
import {
  startAssertionCeremony,
  UserCancelled,
  DeviceUnsupported,
  WebAuthnAbortError,
} from '../lib/webauthn-bridge';
import { signFresh, signFinalize, setExtensionToken } from '../api/client';
import { ApiError } from '../api/types';
import { deliverToOpener, type CeremonyResponse } from '../api/postmessage';

// Fresh ceremony — opens a new per-recipient session.
//
// URL params (from apps/extension-chrome ceremony.types.ts):
//   ?kind=fresh
//   &ceremonyId=<uuid>
//   &extInstallId=<chrome.runtime.id>
//   &returnOrigin=chrome-extension://<id>
//   &recipientSetHash=<sha256-hex>
//   &payloadHash=<sha256-hex>
//   &payloadB64=<base64url(canonical-EmailPayload-JSON)>
//   &credentialId=<webauthn-cred-id>
//   &extToken=<bearer>
//
// payloadB64 carries the canonical EmailPayload that the extension already
// computed in extract-payload.ts. We do NOT trust it as a hash source —
// per ADR-0010 we always hash it ourselves and compare against the
// payloadHash URL param (extension provided both for cross-check). We
// then re-fetch a server-issued challenge by POSTing the same payload to
// /v1/sign; if the server's challenge value derives from a different
// hash we surface a tamper warning.

type Phase =
  | { kind: 'loading' }
  | { kind: 'tamper'; message: string }
  | { kind: 'opener-error'; reason: string }
  | { kind: 'ready'; payload: EmailPayload; payloadHash: string; serverChallenge: string }
  | { kind: 'signing'; payload: EmailPayload; payloadHash: string; serverChallenge: string }
  | { kind: 'finalize-error'; code: string; detail: string }
  | { kind: 'cancelled' }
  | { kind: 'success' };

interface CeremonyParams {
  ceremonyId: string;
  extInstallId: string;
  returnOrigin: string;
  recipientSetHash: string;
  payloadHash: string;
  payloadB64: string;
  credentialId: string;
  extToken: string;
}

function parseParams(search: string): CeremonyParams | null {
  const p = new URLSearchParams(search);
  const required = [
    'ceremonyId', 'extInstallId', 'returnOrigin',
    'recipientSetHash', 'payloadHash', 'payloadB64',
    'credentialId', 'extToken',
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
  };
}

function decodeBase64UrlJson<T>(b64u: string): T {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(decodeURIComponent(escape(json))) as T;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(hashBuffer);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += arr[i]!.toString(16).padStart(2, '0');
  return out;
}

export function SignStart() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const params = useMemo<CeremonyParams | null>(
    () => parseParams(window.location.search),
    [],
  );

  // ── Page-load gate: validate opener + reconstruct payload + cross-check hash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!params) {
        setPhase({ kind: 'opener-error', reason: 'missing-params' });
        return;
      }
      const opener = validateOpenerFromWindow(window, window.location.search);
      if (!opener.ok) {
        setPhase({ kind: 'opener-error', reason: opener.reason });
        return;
      }

      // Reconstruct canonical payload, recompute hash, compare to URL param.
      // ADR-0010: never trust the URL hash without recomputing.
      let payload: EmailPayload;
      try {
        payload = decodeBase64UrlJson<EmailPayload>(params.payloadB64);
      } catch {
        setPhase({ kind: 'tamper', message: 'Could not decode payload from launcher.' });
        return;
      }
      const canonicalJson = JSON.stringify(payload);
      const localHash = await sha256Hex(new TextEncoder().encode(canonicalJson));
      if (localHash !== params.payloadHash) {
        setPhase({
          kind: 'tamper',
          message: 'Payload hash from launcher does not match the canonical bytes. The message may have been tampered with after the extension extracted it.',
        });
        return;
      }

      // Wire the bearer token for /v1/sign + /v1/sign/finalize.
      setExtensionToken(params.extToken);

      // Re-issue the challenge server-side. Per ADR-0010 the popup never
      // trusts the launcher for the canonical hash — the server recomputes
      // it from the payload we POST and binds the challenge to ITS hash.
      try {
        const signResp = await signFresh({
          payload,
          recipientSetHash: params.recipientSetHash,
          credentialId:     params.credentialId,
          freshBiometric:   true,
        });
        if (!signResp.ok) {
          if (cancelled) return;
          setPhase({ kind: 'finalize-error', code: signResp.error, detail: 'Policy denied this signing request.' });
          return;
        }
        if (signResp.policyDecision === 'COSIGN_REQUIRED') {
          if (cancelled) return;
          setPhase({
            kind: 'finalize-error',
            code: 'COSIGN_REQUIRED',
            detail: `This wire requires cosignature. Send a cosign request to one of: ${signResp.approvers.join(', ')}.`,
          });
          return;
        }
        if (cancelled) return;
        setPhase({
          kind: 'ready',
          payload,
          payloadHash: localHash,
          serverChallenge: signResp.challenge.challenge,
        });
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : null;
        setPhase({
          kind: 'finalize-error',
          code: err?.code ?? 'NETWORK',
          detail: err?.message ?? 'Could not reach the signing server.',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [params]);

  // ── Sign + finalize
  async function runCeremony(): Promise<void> {
    if (phase.kind !== 'ready' || !params) return;
    const { payload, payloadHash, serverChallenge } = phase;
    setPhase({ kind: 'signing', payload, payloadHash, serverChallenge });

    try {
      // userVerification: 'required' — the actual biometric prompt.
      // allowCredentials[].id is the JSON form (Base64URLString) — the
      // @simplewebauthn/browser layer decodes to a BufferSource itself
      // before calling navigator.credentials.get. Passing a Uint8Array
      // here breaks the lib's internal base64URLStringToBuffer (it
      // calls .replace on a non-string) → "l.replace is not a function".
      const assertion = await startAssertionCeremony({
        challenge: serverChallenge,
        rpId: 'proofline-sign.web.app',
        allowCredentials: [{ type: 'public-key', id: params.credentialId }],
        userVerification: 'required',
        timeout: 60_000,
      });

      const finalizeResp = await signFinalize(
        {
          assertion: {
            credentialId:      assertion.id,
            clientDataJSON:    assertion.response.clientDataJSON,
            authenticatorData: assertion.response.authenticatorData,
            signature:         assertion.response.signature,
            userHandle:        assertion.response.userHandle ?? undefined,
          },
          payloadHash:      payloadHash,
          recipientSetHash: params.recipientSetHash,
          path:             'fresh',
        },
        params.ceremonyId,
      );

      if (!finalizeResp.ok) {
        const code = finalizeResp.error;
        await deliver({
          kind: 'error',
          ceremonyId: params.ceremonyId,
          code,
          message: 'Server rejected the assertion.',
        });
        setPhase({ kind: 'finalize-error', code, detail: 'Server rejected the signature.' });
        return;
      }

      await deliver({
        kind: 'sign_success',
        ceremonyId:   params.ceremonyId,
        envelope:     finalizeResp.envelope,
        banner:       finalizeResp.banner,
        sessionToken: finalizeResp.sessionToken,
      });
      setPhase({ kind: 'success' });
      setTimeout(() => window.close(), 200);
    } catch (e) {
      if (e instanceof UserCancelled) {
        await deliver({ kind: 'user_cancelled', ceremonyId: params.ceremonyId });
        setPhase({ kind: 'cancelled' });
        return;
      }
      if (e instanceof DeviceUnsupported) {
        const msg = 'This device does not support passkeys.';
        await deliver({ kind: 'error', ceremonyId: params.ceremonyId, code: 'DEVICE_UNSUPPORTED', message: msg });
        setPhase({ kind: 'finalize-error', code: 'DEVICE_UNSUPPORTED', detail: msg });
        return;
      }
      if (e instanceof WebAuthnAbortError) {
        await deliver({ kind: 'user_cancelled', ceremonyId: params.ceremonyId });
        setPhase({ kind: 'cancelled' });
        return;
      }
      const code = e instanceof ApiError ? e.code : 'INTERNAL_ERROR';
      const detail = e instanceof Error ? e.message : 'Unexpected error.';
      await deliver({ kind: 'error', ceremonyId: params.ceremonyId, code, message: detail });
      setPhase({ kind: 'finalize-error', code, detail });
    }
  }

  async function deliver(response: CeremonyResponse): Promise<void> {
    if (!params) return;
    await deliverToOpener(response, {
      extInstallId: params.extInstallId,
      returnOrigin: params.returnOrigin,
    });
  }

  // ── Render
  if (phase.kind === 'opener-error') {
    return (
      <ErrorScreen
        title="This page can only be opened by the ProofLine extension"
        detail="Open Gmail, click Sign in your compose window, and approve the prompt that appears."
        code={phase.reason}
      />
    );
  }
  if (phase.kind === 'tamper') {
    return (
      <ErrorScreen
        title="Payload check failed"
        detail={phase.message}
        code="PAYLOAD_HASH_MISMATCH"
        onCancel={() => window.close()}
        cancelLabel="Close"
      />
    );
  }
  if (phase.kind === 'finalize-error') {
    return (
      <ErrorScreen
        title="Signing was not completed"
        detail={phase.detail}
        code={phase.code}
        onRetry={() => window.location.reload()}
        onCancel={() => window.close()}
      />
    );
  }
  if (phase.kind === 'cancelled') {
    return (
      <ErrorScreen
        title="Cancelled"
        detail="No signature was produced. You can close this window or try again."
        onRetry={() => window.location.reload()}
        onCancel={() => window.close()}
      />
    );
  }
  if (phase.kind === 'success') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-12 text-center space-y-3" role="status" aria-live="polite">
          <ProofLineLogo size="sm" />
          <p className="text-base text-[#0F9D58]">Signed. Returning to Gmail…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-8 space-y-5">
        <header className="flex items-center justify-between">
          <ProofLineLogo size="sm" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Sign request
          </span>
        </header>

        {phase.kind === 'loading' && (
          <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-center" role="status" aria-live="polite">
            <span aria-hidden="true" className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#0D6EFD] border-t-transparent" />
            <p className="text-sm text-gray-600">Verifying request with ProofLine…</p>
          </div>
        )}
        {(phase.kind === 'ready' || phase.kind === 'signing') && (
          <>
            <PayloadPreview payload={phase.payload} payloadHash={phase.payloadHash} />
            <BiometricButton
              onClick={() => void runCeremony()}
              loading={phase.kind === 'signing'}
            />
            <SessionInfo recipientCount={phase.payload.to.length} />
          </>
        )}
      </div>
    </div>
  );
}
