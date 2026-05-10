import * as crypto from 'node:crypto';
import type {
  KYBProvider,
  BusinessLookupInput,
  BusinessVerification,
  OfficerKYCInput,
  OfficerVerification,
} from '../types.js';

const DEFAULT_LATENCY_MS = 1800;
const LATENCY_JITTER_MS = 300;

function deterministicHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export interface StubKYBOptions {
  delay?: (ms: number) => Promise<void>;
  baseLatencyMs?: number;
  jitterMs?: number;
}

async function simulateLatency(opts?: StubKYBOptions): Promise<void> {
  const base = opts?.baseLatencyMs ?? DEFAULT_LATENCY_MS;
  const jitter = opts?.jitterMs ?? LATENCY_JITTER_MS;
  const offset = (Date.now() % (jitter * 2)) - jitter;
  const ms = base + offset;
  const delay = opts?.delay ?? ((ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms)));
  await delay(ms);
}

export function makeStubKYBProvider(opts?: StubKYBOptions): KYBProvider {
  return {
    async verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification> {
      await simulateLatency(opts);

      const hash = deterministicHash(input.ein);
      const isRejected = input.ein.startsWith('00');

      if (isRejected) {
        return {
          ok: false,
          vendorRef: `stub_biz_${hash}`,
          flags: [{
            type: 'sanctions_match',
            severity: 'high',
            detail: 'Simulated sanctions list hit (stub provider)',
          }],
          officers: [],
          raw: {
            simulated: true,
            provider: 'stub',
            middeskShape: {
              id: `stub_biz_${hash}`,
              status: 'completed',
              review_status: 'rejected',
              name: input.legalName,
              tin: { tin: input.ein },
              addresses: [{ state: input.state }],
            },
          },
        };
      }

      return {
        ok: true,
        vendorRef: `stub_biz_${hash}`,
        flags: [],
        officers: [
          { name: 'Alice Chen', role: 'CEO' },
          { name: 'Bob Martinez', role: 'CFO' },
        ],
        raw: {
          simulated: true,
          provider: 'stub',
          middeskShape: {
            id: `stub_biz_${hash}`,
            status: 'completed',
            review_status: 'approved',
            name: input.legalName,
            tin: { tin: input.ein },
            addresses: [{ state: input.state }],
            officers: [
              { name: 'Alice Chen', titles: ['CEO'] },
              { name: 'Bob Martinez', titles: ['CFO'] },
            ],
          },
        },
      };
    },

    async verifyOfficer(input: OfficerKYCInput): Promise<OfficerVerification> {
      await simulateLatency(opts);

      const hash = deterministicHash(input.email);

      return {
        ok: true,
        vendorRef: `stub_idv_${hash}`,
        documentVerified: true,
        livenessConfirmed: true,
        matchedExpected: !!input.expectedName,
        raw: {
          simulated: true,
          provider: 'stub',
          email: input.email,
        },
      };
    },
  };
}
