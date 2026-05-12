/**
 * @file bilateral.test.ts
 * @module packages/bilateral/src/__tests__
 *
 * State machine tests for @proofline/bilateral.
 * Acceptance: 15+ vitest cases pass, no implicit state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeBilateralService } from '../service.js';
import { makeMemoryStore }      from '../store.js';
import { deriveStatus }         from '../status.js';
import type { ActorRef, DraftInput } from '../types.js';
import type { BilateralServiceDeps } from '../service.js';


// ─── Test helpers ─────────────────────────────────────────────────────────────

const BASE_NOW = 1_700_000_000; // fixed epoch for deterministic tests

function makeDeps(nowSec = BASE_NOW): BilateralServiceDeps & { clock: { value: number } } {
  const clock = { value: nowSec };
  return {
    store: makeMemoryStore(),
    now:   () => clock.value,
    clock,
  };
}

const DRAFTER:      ActorRef = { userId: 'user-drafter',      companyId: 'co-acme' };
const COUNTERPARTY: ActorRef = { userId: 'user-counterparty', companyId: 'co-scotia' };
const OUTSIDER:     ActorRef = { userId: 'user-outsider',     companyId: 'co-other' };

function makeDraftInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    docId:                 'doc-001',
    docType:               'banking_change',
    drafterCompanyId:      DRAFTER.companyId,
    counterpartyCompanyId: COUNTERPARTY.companyId,
    content:               { accountNumber: '****1234' },
    expiresInSeconds:      3_600,    // 1 hour
    nonce:                 'aaaaaaaaaaaaaaaaaaaaaa',
    ...overrides,
  };
}

// ─── draftDocument ────────────────────────────────────────────────────────────

describe('draftDocument', () => {
  it('creates a document in DRAFT status', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);

    const result = await svc.draftDocument(makeDraftInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.docId).toBe('doc-001');
    expect(result.value.drafterCompanyId).toBe(DRAFTER.companyId);

    const status = await svc.getStatus('doc-001');
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value).toBe('DRAFT');
  });

  it('sets issuedAt and expiresAt from now + expiresInSeconds', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);

    const result = await svc.draftDocument(makeDraftInput({ expiresInSeconds: 7_200 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issuedAt).toBe(BASE_NOW);
    expect(result.value.expiresAt).toBe(BASE_NOW + 7_200);
  });

  it('rejects a duplicate docId', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);

    await svc.draftDocument(makeDraftInput());
    const second = await svc.draftDocument(makeDraftInput());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('DUPLICATE_DOC_ID');
  });

  it('returns DOC_NOT_FOUND for getStatus on unknown docId', async () => {
    const svc = makeBilateralService(makeDeps());
    const res = await svc.getStatus('no-such-doc');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('DOC_NOT_FOUND');
  });
});

// ─── signAsDrafter ────────────────────────────────────────────────────────────

describe('signAsDrafter', () => {
  it('transitions DRAFT → PENDING_COUNTERPARTY', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());

    const result = await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');
    expect(result.ok).toBe(true);

    const status = await svc.getStatus('doc-001');
    expect(status.ok && status.value).toBe('PENDING_COUNTERPARTY');
  });

  it('rejects signing by wrong company', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());

    const result = await svc.signAsDrafter('doc-001', OUTSIDER, 'sig-outsider');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_ACTOR');
  });

  it('rejects double-sign by drafter (already PENDING_COUNTERPARTY)', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-1');

    const second = await svc.signAsDrafter('doc-001', DRAFTER, 'sig-2');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('WRONG_STATUS');
  });

  it('rejects signing a non-existent document', async () => {
    const svc = makeBilateralService(makeDeps());
    const res = await svc.signAsDrafter('ghost', DRAFTER, 'sig');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('DOC_NOT_FOUND');
  });
});

// ─── signAsCounterparty ───────────────────────────────────────────────────────

describe('signAsCounterparty', () => {
  it('transitions PENDING_COUNTERPARTY → BILATERAL_SIGNED', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');

    const result = await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig-counterparty');
    expect(result.ok).toBe(true);

    const status = await svc.getStatus('doc-001');
    expect(status.ok && status.value).toBe('BILATERAL_SIGNED');
  });

  it('rejects signing from DRAFT (drafter has not signed yet)', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());

    const result = await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_STATUS');
  });

  it('rejects double-sign by counterparty (already BILATERAL_SIGNED)', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');
    await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig-1');

    const second = await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig-2');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('WRONG_STATUS');
  });

  it('rejects signing by wrong company', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');

    const result = await svc.signAsCounterparty('doc-001', OUTSIDER, 'sig-outsider');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_ACTOR');
  });
});

// ─── EXPIRED branch ───────────────────────────────────────────────────────────

describe('expiry', () => {
  it('status becomes EXPIRED after expiresAt when in PENDING_COUNTERPARTY', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput({ expiresInSeconds: 3_600 }));
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');

    // Advance clock past expiry.
    deps.clock.value = BASE_NOW + 3_601;

    const status = await svc.getStatus('doc-001');
    expect(status.ok && status.value).toBe('EXPIRED');
  });

  it('counterparty sign attempt on expired doc returns EXPIRED error', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput({ expiresInSeconds: 3_600 }));
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');

    deps.clock.value = BASE_NOW + 3_601;

    const result = await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EXPIRED');
  });

  it('DRAFT docs do not expire (expiry only kicks in after drafter signs)', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput({ expiresInSeconds: 1 }));

    // Advance clock well past the nominal expiry.
    deps.clock.value = BASE_NOW + 9_999;

    const status = await svc.getStatus('doc-001');
    // Still DRAFT — expiry only applies when PENDING_COUNTERPARTY.
    expect(status.ok && status.value).toBe('DRAFT');
  });
});

// ─── REVOKED branch ───────────────────────────────────────────────────────────

describe('revoke', () => {
  it('transitions any non-final status → REVOKED', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());

    const result = await svc.revoke('doc-001', DRAFTER);
    expect(result.ok).toBe(true);

    const status = await svc.getStatus('doc-001');
    expect(status.ok && status.value).toBe('REVOKED');
  });

  it('REVOKED trumps EXPIRED — revoked doc stays REVOKED after expiry', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput({ expiresInSeconds: 3_600 }));
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');
    await svc.revoke('doc-001', DRAFTER);

    // Advance clock past expiry.
    deps.clock.value = BASE_NOW + 9_999;

    const status = await svc.getStatus('doc-001');
    expect(status.ok && status.value).toBe('REVOKED');
  });

  it('rejects revoke by non-drafter company', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());

    const result = await svc.revoke('doc-001', OUTSIDER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_ACTOR');
  });

  it('rejects double-revoke', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.revoke('doc-001', DRAFTER);

    const second = await svc.revoke('doc-001', DRAFTER);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_REVOKED');
  });

  it('rejects revoking a BILATERAL_SIGNED document', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');
    await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig-counterparty');

    const result = await svc.revoke('doc-001', DRAFTER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WRONG_STATUS');
  });

  it('rejects drafter signing a revoked doc', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.revoke('doc-001', DRAFTER);

    const result = await svc.signAsDrafter('doc-001', DRAFTER, 'sig');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_REVOKED');
  });
});

// ─── Event log integrity ──────────────────────────────────────────────────────

describe('event log', () => {
  it('full happy path produces exactly 3 events in order', async () => {
    const deps = makeDeps();
    const svc  = makeBilateralService(deps);
    await svc.draftDocument(makeDraftInput());
    await svc.signAsDrafter('doc-001', DRAFTER, 'sig-drafter');
    await svc.signAsCounterparty('doc-001', COUNTERPARTY, 'sig-cp');

    const store  = deps.store;
    const doc    = await store.get('doc-001');
    expect(doc).not.toBeNull();
    const kinds = doc!.events.map((e) => e.kind);
    expect(kinds).toEqual(['DRAFTED', 'DRAFTER_SIGNED', 'COUNTERPARTY_SIGNED']);
  });

  it('deriveStatus is pure — same doc + time always gives same result', () => {
    const doc = {
      docId:   'doc-001',
      payload: {
        v:                     1 as const,
        docId:                 'doc-001',
        docType:               'banking_change' as const,
        drafterCompanyId:      'co-acme',
        counterpartyCompanyId: 'co-scotia',
        content:               {},
        issuedAt:              BASE_NOW,
        expiresAt:             BASE_NOW + 3_600,
        nonce:                 'aaaaaaaaaaaaaaaaaaaaaa',
      },
      events: [
        { kind: 'DRAFTED' as const,        docId: 'doc-001', actorId: 'co-acme', timestamp: BASE_NOW },
        { kind: 'DRAFTER_SIGNED' as const, docId: 'doc-001', actorId: 'user-1',  timestamp: BASE_NOW + 10, sig: 'sig' },
      ],
    };

    expect(deriveStatus(doc, BASE_NOW + 100)).toBe('PENDING_COUNTERPARTY');
    expect(deriveStatus(doc, BASE_NOW + 100)).toBe('PENDING_COUNTERPARTY'); // idempotent
    expect(deriveStatus(doc, BASE_NOW + 3_601)).toBe('EXPIRED');
  });
});