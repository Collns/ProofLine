/**
 * @file firestore-store.ts
 * @module apps/functions/src/api/bilateral
 *
 * Firestore-backed BilateralStore.
 * Documents stored at bilateral_documents/{docId}.
 * Shape matches the registry view expectation in apps/functions/src/verify/README.md.
 */

import { getFirestore } from "firebase-admin/firestore";
import type { BilateralDocument, BilateralStore } from "@proofline/bilateral";

export function makeFirestoreBilateralStore(): BilateralStore {
  return {
    async save(doc: BilateralDocument): Promise<void> {
      const db  = getFirestore();
      const ref = db.collection("bilateral_documents").doc(doc.docId);
      await ref.set(doc);
    },

    async get(docId: string): Promise<BilateralDocument | null> {
      const db   = getFirestore();
      const snap = await db.collection("bilateral_documents").doc(docId).get();
      if (!snap.exists) return null;
      return snap.data() as BilateralDocument;
    },
  };
}