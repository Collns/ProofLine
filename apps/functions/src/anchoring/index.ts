/**
 * @file index.ts
 * @module apps/functions/src/anchoring
 *
 * Public exports for the anchoring slice.
 */

export { buildBatchPlan } from "./batch.js";
export type { RegistryEvent, RegistryEventKind, BatchPlan } from "./batch.js";

export { postAnchorBatch } from "./post-anchor.js";
export type {
  AnchorRecord,
  AnchorError,
  AnchorStore,
  AnchorLogger,
  AnchorNetwork,
  PostAnchorDeps,
  Result,
} from "./post-anchor.js";

export { runAnchorBatchOnce } from "./run-batch.js";
export type { EventSource, RunAnchorDeps, RunResult } from "./run-batch.js";

export { makeAnchorScheduler } from "./scheduler.js";
export { makeManualAnchorHandler, makeAnchorAdminRouter } from "./manual.js";
export type { ManualAnchorResponse } from "./manual.js";

export {
  makeAnchorRunDeps,
  readAnchorEnv,
  makeConsoleLogger,
  makeFirestoreEventSource,
  makeFirestoreAnchorStore,
  makeStubAnchorProvider,
  makeInMemoryEventSource,
  makeInMemoryAnchorStore,
} from "./service-factory.js";
export type { AnchorEnvConfig } from "./service-factory.js";
