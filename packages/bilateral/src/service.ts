/**
 * @file service.ts
 * @module packages/bilateral/src
 *
 * Bilateral offer/accept state machine.
 *
 * Design principles (per ADR-0006 and TDD §4.4):
 *   - Status is ALWAYS derived from the immutable event log.
 *   - No status field is stored or mutated.
 *   - Every function is a pure append to the event log.
 *   - All state lives in the injected BilateralStore.
 *   - `now` is injected so tests can control time.
 */

import type { BilateralPayload } from '@proofline/types';
import type {
  BilateralDocument,
  BilateralError,
  BilateralStatus,
  BilateralStore,
  DraftInput,
  ActorRef,
  Result,
} from './types.js';
import { deriveStatus } from './status.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface BilateralServiceDeps {
  store: BilateralStore;
  /** Returns current time as unix seconds. Injected for testability. */
  now: () => number;
  /** Generates a unique ID (e.g. randomUUID). Injected for testability. */
  uuid?: () => string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface BilateralService {
  draftDocument(input: DraftInput): Promise<Result<BilateralPayload>>;
  signAsDrafter(docId: string, actor: ActorRef, sig: string): Promise<Result<BilateralDocument>>;
  signAsCounterparty(docId: string, actor: ActorRef, sig: string): Promise<Result<BilateralDocument>>;
  revoke(docId: string, by: ActorRef): Promise<Result<void>>;
  getStatus(docId: string): Promise<Result<BilateralStatus>>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeBilateralService(deps: BilateralServiceDeps): BilateralService {
  const { store, now } = deps;

  function fail(code: BilateralError['code'], detail: string): BilateralError {
    return { ok: false, code, detail };
  }

  return {
    // ── draftDocument ────────────────────────────────────────────────────────

    async draftDocument(input: DraftInput): Promise<Result<BilateralPayload>> {
      // Reject duplicate docIds.
      const existing = await store.get(input.docId);
      if (existing) {
        return fail('DUPLICATE_DOC_ID', `Document ${input.docId} already exists`);
      }

      const nowSec = now();
      const payload: BilateralPayload = {
        v:                     1,
        docId:                 input.docId,
        docType:               input.docType,
        drafterCompanyId:      input.drafterCompanyId,
        counterpartyCompanyId: input.counterpartyCompanyId,
        content:               input.content,
        issuedAt:              nowSec,
        expiresAt:             nowSec + input.expiresInSeconds,
        nonce:                 input.nonce,
      };

      const doc: BilateralDocument = {
        docId:   input.docId,
        payload,
        events: [
          {
            kind:      'DRAFTED',
            docId:     input.docId,
            actorId:   input.drafterCompanyId,
            timestamp: nowSec,
          },
        ],
      };

      await store.save(doc);
      return { ok: true, value: payload };
    },

    // ── signAsDrafter ────────────────────────────────────────────────────────

    async signAsDrafter(
      docId: string,
      actor: ActorRef,
      sig: string,
    ): Promise<Result<BilateralDocument>> {
      const doc = await store.get(docId);
      if (!doc) return fail('DOC_NOT_FOUND', `Document ${docId} not found`);

      const status = deriveStatus(doc, now());

      if (status === 'REVOKED')            return fail('ALREADY_REVOKED', 'Document is revoked');
      if (status === 'EXPIRED')            return fail('EXPIRED', 'Document has expired');
      if (status !== 'DRAFT')              return fail('WRONG_STATUS', `Cannot sign as drafter in status ${status}`);

      // Drafter must belong to the drafterCompany.
      if (actor.companyId !== doc.payload.drafterCompanyId) {
        return fail('WRONG_ACTOR', `Actor company ${actor.companyId} is not the drafter company`);
      }

      doc.events.push({
        kind:      'DRAFTER_SIGNED',
        docId,
        actorId:   actor.userId,
        timestamp: now(),
        sig,
      });

      await store.save(doc);
      return { ok: true, value: doc };
    },

    // ── signAsCounterparty ────────────────────────────────────────────────────

    async signAsCounterparty(
      docId: string,
      actor: ActorRef,
      sig: string,
    ): Promise<Result<BilateralDocument>> {
      const doc = await store.get(docId);
      if (!doc) return fail('DOC_NOT_FOUND', `Document ${docId} not found`);

      const status = deriveStatus(doc, now());

      if (status === 'REVOKED')               return fail('ALREADY_REVOKED', 'Document is revoked');
      if (status === 'EXPIRED')               return fail('EXPIRED', 'Document has expired');
      if (status === 'BILATERAL_SIGNED')      return fail('WRONG_STATUS', 'Document is already bilaterally signed');
      if (status !== 'PENDING_COUNTERPARTY')  return fail('WRONG_STATUS', `Cannot sign as counterparty in status ${status}`);

      // Counterparty must belong to the counterpartyCompany.
      if (actor.companyId !== doc.payload.counterpartyCompanyId) {
        return fail('WRONG_ACTOR', `Actor company ${actor.companyId} is not the counterparty company`);
      }

      doc.events.push({
        kind:      'COUNTERPARTY_SIGNED',
        docId,
        actorId:   actor.userId,
        timestamp: now(),
        sig,
      });

      await store.save(doc);
      return { ok: true, value: doc };
    },

    // ── revoke ────────────────────────────────────────────────────────────────

    async revoke(docId: string, by: ActorRef): Promise<Result<void>> {
      const doc = await store.get(docId);
      if (!doc) return fail('DOC_NOT_FOUND', `Document ${docId} not found`);

      const status = deriveStatus(doc, now());

      if (status === 'REVOKED')          return fail('ALREADY_REVOKED', 'Document is already revoked');
      if (status === 'BILATERAL_SIGNED') return fail('WRONG_STATUS', 'Cannot revoke a bilaterally signed document');

      // Only the drafter company can revoke.
      if (by.companyId !== doc.payload.drafterCompanyId) {
        return fail('WRONG_ACTOR', `Only the drafter company can revoke; got ${by.companyId}`);
      }

      doc.events.push({
        kind:      'REVOKED',
        docId,
        actorId:   by.userId,
        timestamp: now(),
      });

      await store.save(doc);
      return { ok: true, value: undefined };
    },

    // ── getStatus ─────────────────────────────────────────────────────────────

    async getStatus(docId: string): Promise<Result<BilateralStatus>> {
      const doc = await store.get(docId);
      if (!doc) return fail('DOC_NOT_FOUND', `Document ${docId} not found`);
      return { ok: true, value: deriveStatus(doc, now()) };
    },
  };
}