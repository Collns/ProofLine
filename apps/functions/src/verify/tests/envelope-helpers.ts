/**
 * Test helpers for building real signed envelopes (ECDSA P-256) and
 * planting the matching companies/users/credentials/anchors into the
 * stub Firestore. Mirrors packages/verification/src/__tests__/helpers.ts
 * but in a test-internal-only way (no cross-package private imports).
 */

import * as crypto from "node:crypto";
import { canonicalize } from "@proofline/canonical";
import type { Hex32 } from "@proofline/verification";
import type {
  EmailPayload,
  WirePayload,
  BilateralPayload,
  SignedEnvelope,
  SignerInfo,
  RoleCredential,
} from "@proofline/types";

import { StubStore } from "./firestore-stub.js";

export const ANCHOR_ROOT = "0xdeadbeef" as Hex32;

export interface KeyPair {
  publicKeySpkiBase64: string;
  privateKey: crypto.KeyObject;
}

export function genKeyPair(): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKeySpkiBase64: Buffer.from(publicKey as unknown as Uint8Array).toString(
      "base64",
    ),
    privateKey: crypto.createPrivateKey({
      key: Buffer.from(privateKey as unknown as Uint8Array),
      format: "der",
      type: "pkcs8",
    }),
  };
}

export function signBytes(
  privateKey: crypto.KeyObject,
  message: Uint8Array,
): string {
  const signer = crypto.createSign("SHA256");
  signer.update(message);
  signer.end();
  return signer
    .sign({ key: privateKey, dsaEncoding: "der" })
    .toString("base64url");
}

export function hashPayload(payload: unknown): string {
  return Buffer.from(
    crypto.createHash("sha256").update(canonicalize(payload)).digest(),
  ).toString("base64url");
}

export function makeRoleCredential(opts: {
  credentialId: string;
  userId: string;
  companyId: string;
  publicKey: string;
  issuerPrivateKey: crypto.KeyObject;
  perEmailLimitUsd?: number | null;
  role?: RoleCredential["role"];
}): RoleCredential {
  const cred: RoleCredential = {
    v: 1,
    credentialId: opts.credentialId,
    publicKey: opts.publicKey,
    userId: opts.userId,
    companyId: opts.companyId,
    role: opts.role ?? "employee",
    perEmailLimitUsd: opts.perEmailLimitUsd ?? 10000,
    dailyLimitUsd: null,
    issuedAt: 1_700_000_000,
    revokedAt: null,
    issuerSig: "",
  };
  const credBytes = canonicalize({
    v: cred.v,
    credentialId: cred.credentialId,
    publicKey: cred.publicKey,
    userId: cred.userId,
    companyId: cred.companyId,
    role: cred.role,
    perEmailLimitUsd: cred.perEmailLimitUsd,
    dailyLimitUsd: cred.dailyLimitUsd,
    issuedAt: cred.issuedAt,
  });
  cred.issuerSig = signBytes(opts.issuerPrivateKey, credBytes);
  return cred;
}

export interface SignerSpec {
  userId: string;
  credentialId: string;
  privateKey: crypto.KeyObject;
}

export function buildEnvelope(opts: {
  payload: WirePayload | EmailPayload | BilateralPayload;
  payloadType: "wire" | "email" | "bilateral";
  signers: SignerSpec[];
  anchorRoot?: string | null;
}): SignedEnvelope {
  const message = canonicalize(opts.payload);
  const payloadHash = hashPayload(opts.payload);
  const signerInfos: SignerInfo[] = opts.signers.map((s) => ({
    userId: s.userId,
    credentialId: s.credentialId,
    role: "employee",
    sig: signBytes(s.privateKey, message),
    signedAt: 1_700_000_100,
    sessionId: null,
  }));
  return {
    v: 1,
    payloadType: opts.payloadType,
    payload: opts.payload,
    payloadHash,
    signers: signerInfos,
    anchorRoot: opts.anchorRoot !== undefined ? opts.anchorRoot : ANCHOR_ROOT,
    anchorTxHash: null,
    anchorBlockNumber: null,
  };
}

export interface PlantedScenario {
  companyAKp: KeyPair;
  companyBKp: KeyPair;
  userAKp: KeyPair;
  userBKp: KeyPair;
  credAId: string;
  credBId: string;
  store: StubStore;
}

/** Plants a happy-path two-company scenario into the stub Firestore. */
export function plantScenario(): PlantedScenario {
  const store = new StubStore();
  const companyAKp = genKeyPair();
  const companyBKp = genKeyPair();
  const userAKp = genKeyPair();
  const userBKp = genKeyPair();

  store.set("companies", "company-a", {
    companyId: "company-a",
    domain: "company-a.com",
    legalName: "Company A Inc.",
    rootPublicKey: companyAKp.publicKeySpkiBase64,
    status: "verified",
    verifiedAt: 1_700_000_000,
  });
  store.set("companies", "company-b", {
    companyId: "company-b",
    domain: "company-b.com",
    legalName: "Company B Ltd.",
    rootPublicKey: companyBKp.publicKeySpkiBase64,
    status: "verified",
    verifiedAt: 1_700_000_000,
  });

  store.set("users", "user-a", {
    userId: "user-a",
    companyId: "company-a",
    displayName: "Alice",
    role: "employee",
    status: "active",
  });
  store.set("users", "user-b", {
    userId: "user-b",
    companyId: "company-b",
    displayName: "Bob",
    role: "employee",
    status: "active",
  });

  const credA = makeRoleCredential({
    credentialId: "cred-a",
    userId: "user-a",
    companyId: "company-a",
    publicKey: userAKp.publicKeySpkiBase64,
    issuerPrivateKey: companyAKp.privateKey,
  });
  const credB = makeRoleCredential({
    credentialId: "cred-b",
    userId: "user-b",
    companyId: "company-b",
    publicKey: userBKp.publicKeySpkiBase64,
    issuerPrivateKey: companyBKp.privateKey,
  });

  store.set("users/user-a/role_credentials", credA.credentialId, credA as unknown as Record<string, unknown>);
  store.set("users/user-b/role_credentials", credB.credentialId, credB as unknown as Record<string, unknown>);

  return {
    companyAKp,
    companyBKp,
    userAKp,
    userBKp,
    credAId: credA.credentialId,
    credBId: credB.credentialId,
    store,
  };
}

export function makeEmailPayload(
  overrides: Partial<EmailPayload> = {},
): EmailPayload {
  // Pick issuedAt/expiresAt that won't expire under the default
  // Date.now() — verifyEnvelope pulls now() if no override is given.
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    from: "alice@company-a.com",
    to: ["bob@company-b.com"],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Hi",
    isWireInstruction: false,
    issuedAt: nowSec,
    expiresAt: nowSec + 3600,
    nonce: "nonce-aaaaaaaaaaaaaaaaaaaaaa",
    companyId: "company-a",
    ...overrides,
  };
}

export function makeBilateralPayload(
  overrides: Partial<BilateralPayload> = {},
): BilateralPayload {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    docId: "doc-1",
    docType: "banking_change",
    drafterCompanyId: "company-a",
    counterpartyCompanyId: "company-b",
    content: { note: "test" },
    issuedAt: nowSec,
    expiresAt: nowSec + 86400,
    nonce: "nonce-bbbbbbbbbbbbbbbbbbbbbb",
    ...overrides,
  };
}

/** Real chainReader stub that confirms a single known anchor root. */
export function makeChainReader(opts?: {
  knownRoot?: Hex32 | null;
  blockNumber?: bigint;
  timestamp?: bigint;
}) {
  const known = opts?.knownRoot === undefined ? ANCHOR_ROOT : opts.knownRoot;
  const blockNumber = opts?.blockNumber ?? 42n;
  const timestamp = opts?.timestamp ?? 1_700_000_000n;
  return {
    readAnchor: async (root: Hex32) =>
      known !== null && root === known ? { blockNumber, timestamp } : null,
  };
}
