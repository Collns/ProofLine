/**
 * @file firestore-store.ts
 * @module apps/functions/src/api/invitations
 *
 * Firestore implementation of the InvitationStore port (PFL-026).
 * Collection: counterparty_invitations/{id}. Records hold only the token
 * hash; "expired" is derived at read time by the service.
 */

import type { InvitationRecord, InvitationStore } from "@proofline/invitations";

export const INVITATIONS_COLLECTION = "counterparty_invitations";

export function makeFirestoreInvitationStore(
  firestore: Pick<FirebaseFirestore.Firestore, "collection">,
): InvitationStore {
  const col = () => firestore.collection(INVITATIONS_COLLECTION);
  return {
    async put(record) {
      await col().doc(record.id).set(record);
    },
    async get(id) {
      const snap = await col().doc(id).get();
      return snap.exists ? (snap.data() as InvitationRecord) : null;
    },
    async findByTokenHash(tokenHash) {
      const snap = await col().where("tokenHash", "==", tokenHash).limit(1).get();
      return snap.empty ? null : (snap.docs[0]!.data() as InvitationRecord);
    },
    async listByInviter(companyId) {
      const snap = await col().where("inviterCompanyId", "==", companyId).get();
      return snap.docs.map((d) => d.data() as InvitationRecord);
    },
  };
}
