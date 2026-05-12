/**
 * @file index.ts
 * @module packages/bilateral/src
 *
 * Public surface of @proofline/bilateral.
 */

export type {
  BilateralStatus,
  BilateralEventKind,
  BilateralEvent,
  BilateralDocument,
  DraftInput,
  ActorRef,
  BilateralStore,
  BilateralError,
  Result,
} from './types.js';

export { deriveStatus }        from './status.js';
export { makeMemoryStore }     from './store.js';
export { makeBilateralService } from './service.js';
export type { BilateralService, BilateralServiceDeps } from './service.js';