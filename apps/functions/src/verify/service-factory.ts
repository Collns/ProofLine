/**
 * @file service-factory.ts
 * @module apps/functions/src/verify
 *
 * Wires the verify endpoint's runtime dependencies. Real wiring uses
 * Firestore + Base Sepolia; tests inject in-memory implementations.
 *
 * Env vars consumed (real wiring):
 *   FIREBASE_PROJECT_ID
 *   ANCHOR_CONTRACT_ADDRESS
 *   BASE_SEPOLIA_RPC          (RPC URL for chain reads)
 *   DEPLOYER_PRIVATE_KEY      (NOT used here — verify is read-only)
 */

import type { Firestore } from "firebase-admin/firestore";
import type { RegistryView } from "@proofline/verification";
import type { AnchorProvider } from "@proofline/anchoring";

import { makeFirestoreRegistryView } from "./registry-view.js";

export interface VerifyService {
  registry: RegistryView;
  /** Fetches the raw envelope document by id. Used by the handler before
   *  invoking verifyEnvelope. */
  fetchEnvelope(id: string): Promise<unknown | null>;
}

export interface VerifyServiceDeps {
  firestore: Firestore;
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

export function makeVerifyService(deps: VerifyServiceDeps): VerifyService {
  const registry = makeFirestoreRegistryView(deps);

  async function fetchEnvelope(id: string): Promise<unknown | null> {
    // Two collections can hold envelopes — try signed_messages first
    // (the high-volume path), then bilateral_documents.
    const a = await deps.firestore.collection("signed_messages").doc(id).get();
    if (a.exists) return a.data();

    const b = await deps.firestore
      .collection("bilateral_documents")
      .doc(id)
      .get();
    if (b.exists) return b.data();

    return null;
  }

  return { registry, fetchEnvelope };
}
