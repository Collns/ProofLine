/**
 * @file registry-view.ts
 * @module apps/functions/src/verify
 *
 * Firestore-backed RegistryView for the verify endpoint.
 *
 * verifyEnvelope() (in @proofline/verification) calls this view to
 * resolve companies, users, credentials, anchors, and revocation /
 * nonce state. The view is read-only by construction — the verify
 * endpoint must never mutate Firestore. The interface itself does not
 * include a recordNonce method; nonce-write happens only on the sign
 * path. See README.md for the full contract.
 */

import type { Firestore } from "firebase-admin/firestore";
import type {
  RegistryView,
  Company,
  User,
  Anchor,
  Hex32,
} from "@proofline/verification";
import type { RoleCredential } from "@proofline/types";
import type { AnchorProvider } from "@proofline/anchoring";

export interface FirestoreRegistryViewDeps {
  firestore: Firestore;
  /** Reads anchors from chain — used to confirm Firestore-recorded roots. */
  chainReader: Pick<AnchorProvider, "readAnchor">;
}

interface CompanyDoc {
  companyId?: string;
  domain?: string;
  legalName?: string;
  rootPublicKey?: string;
  status?: Company["status"];
  verifiedAt?: number;
}

interface UserDoc {
  userId?: string;
  companyId?: string;
  displayName?: string;
  role?: User["role"];
  status?: User["status"];
}

interface AnchorDoc {
  root?: string;
  blockNumber?: number | string | bigint;
  timestamp?: number | string | bigint;
  sequence?: number;
}

function toBigInt(x: number | string | bigint | undefined): bigint | null {
  if (x === undefined || x === null) return null;
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  // Strings include both decimal block numbers and unix-second timestamps.
  // Anything that fails parsing returns null so the caller surfaces the
  // missing-anchor case instead of throwing inside the verify pipeline.
  try {
    return BigInt(x);
  } catch {
    return null;
  }
}

function shapeCompany(doc: CompanyDoc, fallbackId: string): Company | null {
  if (!doc.domain || !doc.legalName || !doc.rootPublicKey || !doc.status) {
    return null;
  }
  return {
    companyId: doc.companyId ?? fallbackId,
    domain: doc.domain,
    legalName: doc.legalName,
    rootPublicKey: doc.rootPublicKey,
    status: doc.status,
    verifiedAt: doc.verifiedAt ?? 0,
  };
}

function shapeUser(doc: UserDoc, fallbackId: string): User | null {
  if (!doc.companyId || !doc.displayName || !doc.role || !doc.status) {
    return null;
  }
  return {
    userId: doc.userId ?? fallbackId,
    companyId: doc.companyId,
    displayName: doc.displayName,
    role: doc.role,
    status: doc.status,
  };
}

function shapeAnchorFromDoc(doc: AnchorDoc): Anchor | null {
  if (!doc.root) return null;
  const blockNumber = toBigInt(doc.blockNumber);
  const timestamp = toBigInt(doc.timestamp);
  if (blockNumber === null || timestamp === null) return null;
  return {
    root: doc.root as Hex32,
    blockNumber,
    timestamp,
  };
}

export function makeFirestoreRegistryView(
  deps: FirestoreRegistryViewDeps,
): RegistryView {
  const { firestore, chainReader } = deps;

  return {
    async getCompany(companyId: string): Promise<Company | null> {
      const snap = await firestore.collection("companies").doc(companyId).get();
      if (!snap.exists) return null;
      return shapeCompany(snap.data() as CompanyDoc, companyId);
    },

    async getCompanyByDomain(domain: string): Promise<Company | null> {
      const norm = domain.trim().toLowerCase();
      const q = await firestore
        .collection("companies")
        .where("domain", "==", norm)
        .limit(1)
        .get();
      if (q.empty) return null;
      const first = q.docs[0];
      return shapeCompany(first.data() as CompanyDoc, first.id);
    },

    async getUser(userId: string): Promise<User | null> {
      const snap = await firestore.collection("users").doc(userId).get();
      if (!snap.exists) return null;
      return shapeUser(snap.data() as UserDoc, userId);
    },

    async getUserCredential(credentialId: string): Promise<RoleCredential | null> {
      // Credentials live under users/{userId}/role_credentials/{credId}.
      // collectionGroup lets us look up by credentialId without knowing
      // the parent user. If multiple match (shouldn't happen but defensive),
      // pick the latest by issuedAt.
      const q = await firestore
        .collectionGroup("role_credentials")
        .where("credentialId", "==", credentialId)
        .get();
      if (q.empty) return null;
      const docs = q.docs.map((d) => d.data() as RoleCredential);
      docs.sort((a, b) => (b.issuedAt ?? 0) - (a.issuedAt ?? 0));
      return docs[0] ?? null;
    },

    async isRevoked(credentialId: string): Promise<boolean> {
      const snap = await firestore
        .collection("revocations")
        .doc(credentialId)
        .get();
      return snap.exists;
    },

    async isNonceUsed(nonce: string): Promise<boolean> {
      const snap = await firestore.collection("nonces").doc(nonce).get();
      return snap.exists;
    },

    async getLatestAnchor(): Promise<Anchor | null> {
      const q = await firestore
        .collection("anchors")
        .orderBy("sequence", "desc")
        .limit(1)
        .get();
      if (q.empty) return null;
      return shapeAnchorFromDoc(q.docs[0].data() as AnchorDoc);
    },

    async getAnchorForRoot(root: Hex32): Promise<Anchor | null> {
      // Confirm against chain rather than just trusting Firestore — this is
      // what gives the verify endpoint its on-chain integrity guarantee.
      // If Firestore says the root exists but chain disagrees, the chain
      // wins (return null → verify pipeline emits ANCHOR_NOT_ON_CHAIN).
      const onChain = await chainReader.readAnchor(root);
      if (!onChain) return null;
      return {
        root,
        blockNumber: onChain.blockNumber,
        timestamp: onChain.timestamp,
      };
    },
  };
}
