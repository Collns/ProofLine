import { vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import type { KYBProvider, BusinessVerification, OfficerVerification } from '@proofline/kyb';
import type { EmailProvider } from '@proofline/email';
import type { CryptoProvider, KeyHandle, Signature } from '@proofline/crypto';
import type {
  AnchorProvider,
  Hex32,
  MerkleTree,
  AnchorReceipt,
  MerkleProof,
} from '@proofline/anchoring';
import { sha256 } from '@proofline/crypto';
import type {
  DNSResolver,
  KmsKeyProvisioner,
  OnboardingState,
  OnboardingStore,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';

export const NOW = 1_700_000_000_000;

export function makeMemoryStore(): OnboardingStore & {
  states: Map<string, OnboardingState>;
} {
  const states = new Map<string, OnboardingState>();
  return {
    states,
    async create(state) {
      states.set(state.onboardingId, { ...state });
    },
    async get(id) {
      const s = states.get(id);
      return s ? { ...s } : null;
    },
    async update(id, patch) {
      const existing = states.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      states.set(id, updated);
      return { ...updated };
    },
  };
}

export function makeStubKyb(opts: {
  business?: Partial<BusinessVerification>;
  officer?: Partial<OfficerVerification>;
} = {}): KYBProvider & { calls: { verifyBusiness: number; verifyOfficer: number } } {
  const calls = { verifyBusiness: 0, verifyOfficer: 0 };
  return {
    calls,
    async verifyBusiness() {
      calls.verifyBusiness++;
      return {
        ok: true,
        vendorRef: 'stub_biz_abc123',
        flags: [],
        officers: [{ name: 'Alice Chen', role: 'CEO' }],
        raw: { simulated: true, provider: 'stub' },
        ...opts.business,
      };
    },
    async verifyOfficer() {
      calls.verifyOfficer++;
      return {
        ok: true,
        vendorRef: 'stub_idv_xyz789',
        documentVerified: true,
        livenessConfirmed: true,
        matchedExpected: true,
        raw: { simulated: true, provider: 'stub' },
        ...opts.officer,
      };
    },
  };
}

export function makeStubEmail(): EmailProvider & {
  sent: Array<{ to: string; code: string }>;
} {
  const sent: Array<{ to: string; code: string }> = [];
  return {
    sent,
    async send() {
      return { id: 'msg-1' };
    },
    async sendVerificationCode(to, code) {
      sent.push({ to, code });
    },
    async sendCosignRequest() {},
    async sendInvitation() {},
    async sendBilateralRequest() {},
  };
}

/**
 * Build a CryptoProvider + KmsKeyProvisioner pair that share the same
 * P-256 key store. The provisioner generates a key under a kms://… handle,
 * and the crypto provider can sign with that handle (or with webauthn
 * handles too, for tests that need them).
 */
export function makeCryptoAndKms(): {
  cryptoProvider: CryptoProvider;
  kmsProvisioner: KmsKeyProvisioner & {
    calls: number;
    lastCompanyId?: string;
  };
  keys: Map<string, nodeCrypto.KeyObject>;
} {
  const keys = new Map<string, nodeCrypto.KeyObject>();
  const provisionerMeta = { calls: 0, lastCompanyId: undefined as string | undefined };

  const cryptoProvider: CryptoProvider = {
    async sign(handle: KeyHandle, message: Uint8Array): Promise<Signature> {
      const id =
        handle.kind === 'kms'
          ? handle.resourceName
          : handle.credentialId;
      const key = keys.get(id);
      if (!key) throw new Error(`unknown key handle: ${id}`);
      const signer = nodeCrypto.createSign('SHA256');
      signer.update(message);
      signer.end();
      return signer.sign({ key, dsaEncoding: 'der' }).toString('base64url');
    },
    async verify(publicKey: string, message: Uint8Array, sig: string): Promise<boolean> {
      try {
        const pub = nodeCrypto.createPublicKey({
          key: Buffer.from(publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        });
        const verifier = nodeCrypto.createVerify('SHA256');
        verifier.update(message);
        verifier.end();
        return verifier.verify(
          { key: pub, dsaEncoding: 'der' },
          Buffer.from(sig, 'base64url'),
        );
      } catch {
        return false;
      }
    },
    hash: sha256,
    randomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };

  const kmsProvisioner: KmsKeyProvisioner & {
    calls: number;
    lastCompanyId?: string;
  } = {
    ...provisionerMeta,
    async createCompanyRootKey({ companyId }) {
      provisionerMeta.calls++;
      provisionerMeta.lastCompanyId = companyId;
      const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
      });
      const resourceName = `kms://${companyId}/${nodeCrypto.randomBytes(8).toString('hex')}`;
      keys.set(resourceName, privateKey);
      const spki = publicKey.export({ type: 'spki', format: 'der' });
      return {
        handle: { kind: 'kms', resourceName },
        publicKey: (spki as Buffer).toString('base64'),
      };
    },
  };

  // Make the meta fields readable through proxies so callers see updated values
  Object.defineProperty(kmsProvisioner, 'calls', {
    get: () => provisionerMeta.calls,
  });
  Object.defineProperty(kmsProvisioner, 'lastCompanyId', {
    get: () => provisionerMeta.lastCompanyId,
  });

  return { cryptoProvider, kmsProvisioner, keys };
}

export function makeStubAnchor(): AnchorProvider & {
  posted: Hex32[];
  txCounter: number;
} {
  const posted: Hex32[] = [];
  const meta = { posted, txCounter: 0 };
  return {
    ...meta,
    buildTree(leaves: Hex32[]): MerkleTree {
      const root = leaves[0]!;
      return {
        root,
        leaves,
        proofFor(leaf) {
          if (leaf !== root) return null;
          const proof: MerkleProof = { leaf, siblings: [], pathIndex: 0n };
          return proof;
        },
      };
    },
    async postAnchor(root: Hex32): Promise<AnchorReceipt> {
      meta.txCounter++;
      posted.push(root);
      return {
        root,
        txHash: `0x${meta.txCounter.toString(16).padStart(64, '0')}` as `0x${string}`,
        blockNumber: BigInt(1_000_000 + meta.txCounter),
        timestamp: BigInt(NOW),
      };
    },
    async readAnchor() {
      return null;
    },
    verifyProof() {
      return true;
    },
  };
}

export function makeStubDns(records: Map<string, string[][]>): DNSResolver {
  return {
    async resolveTxt(name) {
      const r = records.get(name);
      if (!r) throw new Error('ENOTFOUND');
      return r;
    },
  };
}

export function makeDeps(overrides: Partial<OnboardingDeps> = {}): OnboardingDeps {
  let uuidCounter = 0;
  const { cryptoProvider, kmsProvisioner } = makeCryptoAndKms();
  return {
    store: makeMemoryStore(),
    kyb: makeStubKyb(),
    email: makeStubEmail(),
    crypto: cryptoProvider,
    anchor: makeStubAnchor(),
    kmsProvisioner,
    dns: makeStubDns(new Map()),
    now: () => NOW,
    uuid: () => `id-${++uuidCounter}`,
    randomCode: vi
      .fn()
      .mockReturnValueOnce('111111')
      .mockReturnValueOnce('222222')
      .mockReturnValue('999999'),
    ...overrides,
  };
}
