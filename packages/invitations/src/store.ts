/**
 * @file store.ts
 * @module packages/invitations
 *
 * In-memory InvitationStore for tests and local tooling. The Firestore
 * store (collection `counterparty_invitations`) lives in apps/functions.
 */

import type { InvitationRecord, InvitationStore } from "./types.js";

export function makeMemoryInvitationStore(): InvitationStore & { size(): number } {
  const records = new Map<string, InvitationRecord>();
  const clone = (r: InvitationRecord): InvitationRecord => structuredClone(r);

  return {
    async put(record) {
      records.set(record.id, clone(record));
    },
    async get(id) {
      const r = records.get(id);
      return r ? clone(r) : null;
    },
    async findByTokenHash(tokenHash) {
      for (const r of records.values()) if (r.tokenHash === tokenHash) return clone(r);
      return null;
    },
    async listByInviter(companyId) {
      return [...records.values()].filter((r) => r.inviterCompanyId === companyId).map(clone);
    },
    size() {
      return records.size;
    },
  };
}
