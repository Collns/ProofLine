/**
 * @file cosign-release.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-136 — release a held wire once its cosigner approves.
 *
 * After the sender signs a wire that needs a cosigner, Send stays blocked
 * (send-guard state "cosign_pending"). This watcher polls the envelope's
 * status through the background worker. When it is COSIGNED, it inserts
 * the two-signer banner into the compose and marks it signed, which
 * unblocks Send. The user still clicks Send themselves.
 *
 * The watch stops when the compose closes, when the user starts a new
 * signing attempt on it (the watched envelope id changes), or after
 * MAX_WATCH_MS. Polling slows down after the first half hour.
 */

export const COSIGN_ENVELOPE_ATTR = 'data-proofline-cosign-envelope';
export const COSIGN_POLL_MS       = 10_000;
export const COSIGN_SLOW_POLL_MS  = 60_000;
export const COSIGN_SLOW_AFTER_MS = 30 * 60_000;
export const MAX_WATCH_MS         = 24 * 60 * 60_000;

export interface CosignStatusReply {
  status?:     string;
  bannerHtml?: string;
}

export interface CosignWatchDeps {
  checkStatus(envelopeId: string): Promise<CosignStatusReply | null>;
  injectBanner(compose: Element, html: string): { ok: boolean };
  markSigned(compose: Element): void;
  isAttached(compose: Element): boolean;
  schedule(fn: () => void, ms: number): unknown;
  now(): number;
}

export function watchCosign(compose: Element, envelopeId: string, deps: CosignWatchDeps): void {
  compose.setAttribute(COSIGN_ENVELOPE_ATTR, envelopeId);
  const startedAt = deps.now();

  const stillWatching = () =>
    deps.isAttached(compose) &&
    compose.getAttribute(COSIGN_ENVELOPE_ATTR) === envelopeId &&
    deps.now() - startedAt < MAX_WATCH_MS;

  const next = () => {
    const elapsed = deps.now() - startedAt;
    deps.schedule(() => { void tick(); }, elapsed < COSIGN_SLOW_AFTER_MS ? COSIGN_POLL_MS : COSIGN_SLOW_POLL_MS);
  };

  const tick = async (): Promise<void> => {
    if (!stillWatching()) return;
    let reply: CosignStatusReply | null = null;
    try {
      reply = await deps.checkStatus(envelopeId);
    } catch {
      reply = null; // transient; try again
    }
    if (!stillWatching()) return;
    if (reply?.status === 'COSIGNED' && reply.bannerHtml) {
      const injected = deps.injectBanner(compose, reply.bannerHtml);
      if (injected.ok) {
        compose.removeAttribute(COSIGN_ENVELOPE_ATTR);
        deps.markSigned(compose);
        return;
      }
    }
    next();
  };

  next();
}
