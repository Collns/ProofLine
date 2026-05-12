/**
 * @file types.ts
 * @module packages/bilateral/src
 *
 * Core types for the bilateral offer/accept state machine.
 * Status is always derived from the event log — never stored mutably.
 */

import type { BilateralPayload } from '@proofline/types';

// ─── Status ───────────────────────────────────────────────────────────────────

export type BilateralStatus =
  | 'DRAFT'
  | 'PENDING_COUNTERPARTY'
  | 'BILATERAL_SIGNED'
  | 'EXPIRED'
  | 'REVOKED';

// ─── Events ───────────────────────────────────────────────────────────────────

export type BilateralEventKind =
  | 'DRAFTED'
  | 'DRAFTER_SIGNED'
  | 'COUNTERPARTY_SIGNED'
  | 'REVOKED';

export interface BilateralEvent {
  kind:      BilateralEventKind;
  docId:     string;
  actorId:   string;       // userId or companyId of the actor
  timestamp: number;       // unix seconds
  sig?:      string;       // base64url signature (present on SIGNED events)
}

// ─── Document record ──────────────────────────────────────────────────────────

export interface BilateralDocument {
  docId:     string;
  payload:   BilateralPayload;
  events:    BilateralEvent[];
}

// ─── Input / output shapes ────────────────────────────────────────────────────

export interface DraftInput {
  docId:                 string;
  docType:               BilateralPayload['docType'];
  drafterCompanyId:      string;
  counterpartyCompanyId: string;
  content:               Record<string, unknown>;
  expiresInSeconds:      number;
  nonce:                 string;
}

export interface ActorRef {
  userId:    string;
  companyId: string;
}

// ─── Store interface (injected — no implicit state) ───────────────────────────

export interface BilateralStore {
  save(doc: BilateralDocument): Promise<void>;
  get(docId: string): Promise<BilateralDocument | null>;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

export type BilateralErrorCode =
  | 'DOC_NOT_FOUND'
  | 'WRONG_STATUS'
  | 'WRONG_ACTOR'
  | 'EXPIRED'
  | 'ALREADY_REVOKED'
  | 'DUPLICATE_DOC_ID';

export interface BilateralError {
  ok:    false;
  code:  BilateralErrorCode;
  detail: string;
}

export type Result<T> = { ok: true; value: T } | BilateralError;