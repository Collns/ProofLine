/**
 * Test helpers: key generation, signing, envelope/registry factories.
 * Uses node:crypto directly — no external deps beyond what the package already has.
 */
import * as nodeCrypto from 'node:crypto';
import { sha256 } from '@proofline/crypto';
import { canonicalize } from '@proofline/canonical';
import type {
  SignedEnvelope,
  SignerInfo,
  RoleCredential,
  WirePayload,
  EmailPayload,
  BilateralPayload,
} from '@proofline/types';
import type { RegistryView, Company, User, Anchor, Hex32 } from '../types.js';

// ─── Key pair helpers ─────────────────────────────────────────────────────────

export interface KeyPair {
  publicKeySpkiBase64: string;
  privateKey: nodeCrypto.KeyObject;
}

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKeySpkiBase64: Buffer.from(publicKey as unknown as Uint8Array).toString('base64'),
    privateKey: nodeCrypto.createPrivateKey({
      key: Buffer.from(privateKey as unknown as Uint8Array),
      format: 'der',
      type: 'pkcs8',
    }),
  };
}

export function signBytes(privateKey: nodeCrypto.KeyObject, message: Uint8Array): string {
  const signer = nodeCrypto.createSign('SHA256');
  signer.update(message);
  signer.end();
  return signer.sign({ key: privateKey, dsaEncoding: 'der' }).toString('base64url');
}

// ─── Payload factories ────────────────────────────────────────────────────────

export function makeWirePayload(overrides?: Partial<WirePayload>): WirePayload {
  return {
    v: 1,
    amount: 5000,
    currency: 'USD',
    recipientAccount: '1234',
    recipientRouting: '021000021',
    ...overrides,
  };
}

export function makeEmailPayload(overrides?: Partial<EmailPayload>): EmailPayload {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    from: 'alice@company-a.com',
    to: ['bob@company-b.com'],
    cc: [],
    bcc: [],
    subject: 'Test',
    body: 'Hello',
    isWireInstruction: false,
    issuedAt: nowSec,
    expiresAt: nowSec + 3600,
    nonce: 'aaaaaaaaaaaaaaaaaaaaaa',
    companyId: 'company-a',
    ...overrides,
  };
}

export function makeBilateralPayload(overrides?: Partial<BilateralPayload>): BilateralPayload {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    docId: 'doc-1',
    docType: 'payment_terms',
    drafterCompanyId: 'company-a',
    counterpartyCompanyId: 'company-b',
    content: { terms: 'net30' },
    issuedAt: nowSec,
    expiresAt: nowSec + 86400,
    nonce: 'bbbbbbbbbbbbbbbbbbbbbb',
    ...overrides,
  };
}

// ─── Envelope + credential factories ─────────────────────────────────────────

export function hashPayload(payload: unknown): string {
  return Buffer.from(sha256(canonicalize(payload))).toString('base64url');
}

export function makeRoleCredential(opts: {
  credentialId: string;
  userId: string;
  companyId: string;
  role?: RoleCredential['role'];
  perEmailLimitUsd?: number | null;
  publicKey: string;       // SPKI base64
  issuerPrivateKey: nodeCrypto.KeyObject;
  issuedAt?: number;
}): RoleCredential {
  const credential = {
    v: 1 as const,
    credentialId: opts.credentialId,
    publicKey: opts.publicKey,
    userId: opts.userId,
    companyId: opts.companyId,
    role: opts.role ?? ('employee' as const),
    perEmailLimitUsd: opts.perEmailLimitUsd ?? 10000,
    dailyLimitUsd: null,
    issuedAt: opts.issuedAt ?? Math.floor(Date.now() / 1000),
    revokedAt: null,
    issuerSig: '',  // will be set below
  };

  const credBytes = canonicalize({
    v: credential.v,
    credentialId: credential.credentialId,
    publicKey: credential.publicKey,
    userId: credential.userId,
    companyId: credential.companyId,
    role: credential.role,
    perEmailLimitUsd: credential.perEmailLimitUsd,
    dailyLimitUsd: credential.dailyLimitUsd,
    issuedAt: credential.issuedAt,
  });

  credential.issuerSig = signBytes(opts.issuerPrivateKey, credBytes);
  return credential;
}

export interface SignerSpec {
  userId: string;
  credentialId: string;
  privateKey: nodeCrypto.KeyObject;
  sessionId?: string | null;
}

export function buildEnvelope(opts: {
  payload: WirePayload | EmailPayload | BilateralPayload;
  payloadType: 'wire' | 'email' | 'bilateral';
  signerSpecs: SignerSpec[];
  anchorRoot?: string | null;
}): SignedEnvelope {
  const { payload, payloadType, signerSpecs } = opts;
  const payloadHash = hashPayload(payload);
  const message = canonicalize(payload);

  const signers: SignerInfo[] = signerSpecs.map(s => ({
    userId: s.userId,
    credentialId: s.credentialId,
    role: 'employee',
    sig: signBytes(s.privateKey, message),
    signedAt: Math.floor(Date.now() / 1000),
    sessionId: s.sessionId ?? null,
  }));

  return {
    v: 1,
    payloadType,
    payload,
    payloadHash,
    signers,
    anchorRoot: opts.anchorRoot !== undefined ? opts.anchorRoot : 'fake-anchor-root',
    anchorTxHash: null,
    anchorBlockNumber: null,
  };
}

// ─── In-memory RegistryView ───────────────────────────────────────────────────

const STUB_ANCHOR: Anchor = {
  root: '0xdeadbeef' as Hex32,
  blockNumber: 42n,
  timestamp: 1700000000n,
};

export class InMemoryRegistry implements RegistryView {
  private companies = new Map<string, Company>();
  private users = new Map<string, User>();
  private credentials = new Map<string, RoleCredential>();
  private revokedCredentials = new Set<string>();
  private usedNonces = new Set<string>();
  private anchors = new Map<string, Anchor>();
  latestAnchor: Anchor | null = STUB_ANCHOR;

  addCompany(c: Company): this {
    this.companies.set(c.companyId, c);
    return this;
  }
  addUser(u: User): this {
    this.users.set(u.userId, u);
    return this;
  }
  addCredential(cred: RoleCredential): this {
    this.credentials.set(cred.credentialId, cred);
    return this;
  }
  revokeCredential(credentialId: string): this {
    this.revokedCredentials.add(credentialId);
    return this;
  }
  addNonce(nonce: string): this {
    this.usedNonces.add(nonce);
    return this;
  }
  addAnchor(anchor: Anchor): this {
    this.anchors.set(anchor.root, anchor);
    return this;
  }

  async getCompany(companyId: string): Promise<Company | null> {
    return this.companies.get(companyId) ?? null;
  }
  async getCompanyByDomain(domain: string): Promise<Company | null> {
    for (const c of this.companies.values()) if (c.domain === domain) return c;
    return null;
  }
  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }
  async getUserCredential(credentialId: string): Promise<RoleCredential | null> {
    return this.credentials.get(credentialId) ?? null;
  }
  async isRevoked(credentialId: string): Promise<boolean> {
    return this.revokedCredentials.has(credentialId);
  }
  async isNonceUsed(nonce: string): Promise<boolean> {
    return this.usedNonces.has(nonce);
  }
  async getLatestAnchor(): Promise<Anchor | null> {
    return this.latestAnchor;
  }
  async getAnchorForRoot(root: Hex32): Promise<Anchor | null> {
    return this.anchors.get(root) ?? null;
  }
}

// ─── Scenario builder ─────────────────────────────────────────────────────────

export interface TestScenario {
  companyAKp: KeyPair;       // company A root key pair
  companyBKp: KeyPair;       // company B root key pair
  userAKp: KeyPair;          // user A signing key pair
  userBKp: KeyPair;          // user B signing key pair
  companyA: Company;
  companyB: Company;
  userA: User;
  userB: User;
  credA: RoleCredential;
  credB: RoleCredential;
  registry: InMemoryRegistry;
  anchor: Anchor;
}

export function buildScenario(opts?: {
  perEmailLimitUsd?: number | null;
  userARole?: 'owner' | 'manager' | 'employee';
}): TestScenario {
  const companyAKp = generateKeyPair();
  const companyBKp = generateKeyPair();
  const userAKp = generateKeyPair();
  const userBKp = generateKeyPair();

  const companyA: Company = {
    companyId: 'company-a',
    domain: 'company-a.com',
    legalName: 'Company A Inc.',
    rootPublicKey: companyAKp.publicKeySpkiBase64,
    status: 'verified',
    verifiedAt: 1700000000,
  };
  const companyB: Company = {
    companyId: 'company-b',
    domain: 'company-b.com',
    legalName: 'Company B Ltd.',
    rootPublicKey: companyBKp.publicKeySpkiBase64,
    status: 'verified',
    verifiedAt: 1700000000,
  };

  const userA: User = {
    userId: 'user-a',
    companyId: 'company-a',
    displayName: 'Alice',
    role: opts?.userARole ?? 'employee',
    status: 'active',
  };
  const userB: User = {
    userId: 'user-b',
    companyId: 'company-b',
    displayName: 'Bob',
    role: 'employee',
    status: 'active',
  };

  const credA = makeRoleCredential({
    credentialId: 'cred-a',
    userId: 'user-a',
    companyId: 'company-a',
    role: opts?.userARole ?? 'employee',
    perEmailLimitUsd: opts?.perEmailLimitUsd ?? 10000,
    publicKey: userAKp.publicKeySpkiBase64,
    issuerPrivateKey: companyAKp.privateKey,
  });
  const credB = makeRoleCredential({
    credentialId: 'cred-b',
    userId: 'user-b',
    companyId: 'company-b',
    role: 'employee',
    perEmailLimitUsd: 10000,
    publicKey: userBKp.publicKeySpkiBase64,
    issuerPrivateKey: companyBKp.privateKey,
  });

  const anchor: Anchor = {
    root: '0xdeadbeef' as Hex32,
    blockNumber: 42n,
    timestamp: 1700000000n,
  };

  const registry = new InMemoryRegistry();
  registry
    .addCompany(companyA)
    .addCompany(companyB)
    .addUser(userA)
    .addUser(userB)
    .addCredential(credA)
    .addCredential(credB)
    .addAnchor(anchor);

  return {
    companyAKp, companyBKp, userAKp, userBKp,
    companyA, companyB, userA, userB,
    credA, credB,
    registry,
    anchor,
  };
}
