/**
 * @file index.ts
 * @module packages/invitations
 *
 * Public surface of @proofline/invitations (PFL-026): counterparty
 * invitation types, service and an in-memory store.
 */

export * from "./types.js";
export {
  makeInvitationService,
  hashToken,
  normalizeEmail,
  DEFAULT_TTL_MS,
  DEFAULT_BULK_LIMIT,
  MAX_MESSAGE_LENGTH,
} from "./service.js";
export type { InvitationService, InvitationServiceDeps } from "./service.js";
export { makeMemoryInvitationStore } from "./store.js";
