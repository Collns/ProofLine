import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { CosignLayout } from '../components/CosignLayout';
import { WirePayloadCard } from '../components/WirePayloadCard';
import { SignerInfoCard } from '../components/SignerInfoCard';
import { VerificationChecklist } from '../components/VerificationChecklist';
import { BiometricApprove } from '../components/BiometricApprove';
import { ErrorScreen } from '../components/ErrorScreen';

import { getCosignContext, finalizeCosign } from '../api/client';
import { fixtureJws } from '../api/fixtures';
import type { CosignContextResponse } from '../api/types';
import { runCosignAssertion } from '../lib/webauthn-bridge';
import {
  runVerifyChecklist,
  STEP_ORDER,
  STEP_LABELS,
} from '../lib/verify-checklist';
import type { ChecklistStep } from '../lib/verify-checklist';

const ANIMATION_DELAY_MS = 150;

function pendingSteps(signerName: string): ChecklistStep[] {
  return STEP_ORDER.map((id) => ({
    id,
    label:  STEP_LABELS[id](signerName),
    status: 'pending' as const,
  }));
}

export function CosignLanding() {
  const navigate    = useNavigate();
  const { messageId = '' } = useParams<{ messageId: string }>();
  const [searchParams] = useSearchParams();

  const fixtureKey = searchParams.get('fixture');
  const tokenParam = searchParams.get('t') ?? '';

  // Resolve the JWS to use: live param OR a synthetic-but-decodable fixture JWS.
  const jws = useMemo(() => {
    if (fixtureKey) return fixtureJws(fixtureKey);
    return tokenParam;
  }, [fixtureKey, tokenParam]);

  const [context, setContext] = useState<CosignContextResponse | null>(null);
  const [steps, setSteps]     = useState<ChecklistStep[]>(() => pendingSteps('the original signer'));
  const [allPassed, setAllPassed] = useState(false);
  const [busyApprove, setBusyApprove] = useState(false);
  const [terminalError, setTerminalError] = useState<{ title: string; detail: string } | null>(null);

  // ── Effect: fetch context, then run the 6-step checklist.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Step zero: hard-fail when the URL is missing the JWS parameter and
      // we're not in fixture mode.
      if (!jws) {
        setTerminalError({
          title: 'Cosign link is incomplete',
          detail: 'The link is missing its security token. Please use the link from the email exactly as sent.',
        });
        return;
      }

      const ctx = await getCosignContext({ messageId, token: jws });
      if (cancelled) return;
      setContext(ctx);

      // Server-level rejections that route to a different screen.
      if (!ctx.ok) {
        if (ctx.code === 'COSIGN_LINK_EXPIRED') {
          navigate(`/cosign/${encodeURIComponent(messageId)}/expired`, { replace: true });
          return;
        }
        if (ctx.code === 'ALREADY_COSIGNED') {
          setTerminalError({
            title:  'Already cosigned',
            detail: ctx.detail ?? 'This wire has already been cosigned. No further action is required.',
          });
          return;
        }
      }

      // In fixture mode, inject a hasher that returns the server's payloadHash
      // so step 3+4 pass. Tampered fixture still fails because JWS claims
      // a different hash than the server returns.
      // In fixture mode, inject a hasher that returns the server's
      // payloadHash so step 3+4 pass for "ready". Tampered fixture
      // still fails because JWS claims a different hash than server.
      const fixtureHasher = (fixtureKey && ctx.ok)
        ? async () => ctx.payloadHash
        : undefined;

      const outcome = await runVerifyChecklist({
        jws,
        context: ctx,
        sha256Hex: fixtureHasher,
        onStep: async (_step, _index) => {
          if (cancelled) return;
          // Snapshot a *copy* so React notices.
          setSteps((prev) => prev.map((s, i) => (i === _index ? { ..._step } : s)));
          // brief animation pause for visual confirmation
          if (_step.status === 'running') {
            await new Promise<void>((resolve) => setTimeout(resolve, ANIMATION_DELAY_MS));
          }
        },
      });

      if (cancelled) return;
      setSteps(outcome.steps);
      setAllPassed(outcome.allPassed);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [jws, messageId, navigate]);

  async function handleApprove() {
    if (!context || !context.ok || !allPassed) return;
    setBusyApprove(true);

    const assertionResult = await runCosignAssertion({
      challenge: context.cosignChallenge,
    });

    if (!assertionResult.ok) {
      setBusyApprove(false);
      setTerminalError({
        title: 'Could not capture biometric',
        detail:
          assertionResult.code === 'USER_CANCELLED'
            ? 'You cancelled the biometric prompt. Tap Approve again when ready.'
            : assertionResult.code === 'DEVICE_UNSUPPORTED'
              ? 'This device does not support biometric approval. Please open the link on a Touch ID or Face ID device.'
              : 'Biometric capture failed. Please try again.',
      });
      return;
    }

    const finalize = await finalizeCosign({
      messageId,
      token: jws,
      payload: {
        assertion: assertionResult.assertion,
        challenge: context.cosignChallenge,
      },
    });

    setBusyApprove(false);

    if (!finalize.ok) {
      setTerminalError({
        title:  'Cosign refused',
        detail: finalize.detail ?? 'The server refused this cosign request.',
      });
      return;
    }

    navigate(`/cosign/${encodeURIComponent(messageId)}/success`, { replace: true });
  }

  if (terminalError) {
    return (
      <CosignLayout>
        <ErrorScreen
          title={terminalError.title}
          detail={terminalError.detail}
          cta={{
            label: 'Request fresh link',
            onClick: () => navigate(`/cosign/${encodeURIComponent(messageId)}/refresh`),
          }}
        />
      </CosignLayout>
    );
  }

  // Loading state — context not yet fetched.
  if (!context) {
    return (
      <CosignLayout>
        <p className="text-sm text-gray-500">Loading cosign request…</p>
      </CosignLayout>
    );
  }

  if (!context.ok) {
    return (
      <CosignLayout>
        <ErrorScreen
          title="Cannot continue"
          detail={context.detail}
          cta={{
            label: 'Request fresh link',
            onClick: () => navigate(`/cosign/${encodeURIComponent(messageId)}/refresh`),
          }}
        />
      </CosignLayout>
    );
  }

  const isWire = context.payloadType === 'wire';

  return (
    <CosignLayout>
      <div className="space-y-5">
        {isWire ? (
          <WirePayloadCard payload={context.payload as Parameters<typeof WirePayloadCard>[0]['payload']} />
        ) : (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">
              This cosign surface currently supports wire instructions. Other payload types
              are coming soon.
            </p>
          </section>
        )}

        <SignerInfoCard signer={context.signer} />

        <VerificationChecklist steps={steps} />

        {isWire ? (
          <BiometricApprove
            amount={(context.payload as { amount: number }).amount}
            recipientAccount={(context.payload as { recipientAccount: string }).recipientAccount}
            disabled={!allPassed}
            busy={busyApprove}
            onClick={handleApprove}
          />
        ) : null}
      </div>
    </CosignLayout>
  );
}
