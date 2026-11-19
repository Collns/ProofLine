/**
 * PFL-026 — Firestore InvitationStore against a minimal in-memory fake.
 */

import { describe, it, expect } from "vitest";
import type { InvitationRecord } from "@proofline/invitations";

import { makeFirestoreInvitationStore, INVITATIONS_COLLECTION } from "../firestore-store.js";

function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const collections: string[] = [];
  const query = (field: string, value: unknown, limit?: number) => ({
    limit: (n: number) => query(field, value, n),
    get: async () => {
      let hits = [...docs.values()].filter((d) => d[field] === value);
      if (limit) hits = hits.slice(0, limit);
      return { empty: hits.length === 0, docs: hits.map((d) => ({ data: () => d })) };
    },
  });
  return {
    collections,
    firestore: {
      collection(name: string) {
        collections.push(name);
        return {
          doc: (id: string) => ({
            set: async (data: Record<string, unknown>) => { docs.set(id, data); },
            get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
          }),
          where: (field: string, _op: string, value: unknown) => query(field, value),
        };
      },
    } as never,
  };
}

const rec = (id: string, companyId: string, tokenHash: string): InvitationRecord => ({
  id, inviterCompanyId: companyId, inviterCompanyName: "Acme", email: `${id}@x.example`, status: "sent",
  sponsoredCost: false, message: null, sentAt: 1, expiresAt: 2, acceptedAt: null, cancelledAt: null,
  acceptingCompanyId: null, acceptingCompanyName: null, inviterUserId: "u", tokenHash, sendCount: 1, updatedAt: 1,
});

describe("makeFirestoreInvitationStore", () => {
  it("puts, gets, finds by token hash and lists by inviter in counterparty_invitations", async () => {
    const fs = fakeFirestore();
    const store = makeFirestoreInvitationStore(fs.firestore);
    await store.put(rec("a", "co-1", "h1"));
    await store.put(rec("b", "co-1", "h2"));
    await store.put(rec("c", "co-2", "h3"));

    expect((await store.get("a"))?.email).toBe("a@x.example");
    expect(await store.get("missing")).toBeNull();
    expect((await store.findByTokenHash("h3"))?.id).toBe("c");
    expect(await store.findByTokenHash("nope")).toBeNull();
    expect((await store.listByInviter("co-1")).map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(new Set(fs.collections)).toEqual(new Set([INVITATIONS_COLLECTION]));
  });
});
