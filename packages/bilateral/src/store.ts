/**
 * @file store.ts
 * @module packages/bilateral/src
 *
 * In-memory BilateralStore — used in tests and as a reference
 * implementation. Production code injects a Firestore-backed store.
 */

import type { BilateralDocument, BilateralStore } from './types.js';

export function makeMemoryStore(): BilateralStore {
  const docs = new Map<string, BilateralDocument>();

  return {
    async save(doc: BilateralDocument): Promise<void> {
      // Store a deep clone so mutations to the caller's object don't
      // affect the stored record.
      docs.set(doc.docId, structuredClone(doc));
    },

    async get(docId: string): Promise<BilateralDocument | null> {
      const doc = docs.get(docId);
      return doc ? structuredClone(doc) : null;
    },
  };
}