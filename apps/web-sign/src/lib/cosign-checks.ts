// PFL-136 / F-SIG-09 — checks the approval page runs before it offers the
// biometric prompt. The server is the authority (it verifies the link
// signature and the assertion); these checks make sure what the approver
// sees is exactly what they would be signing.

import { canonicalize } from '@proofline/canonical';
import type { EmailPayload } from '@proofline/types';

export interface CosignCheck {
  id: 'payload-hash' | 'link-binding' | 'link-expiry' | 'company' | 'wire';
  label: string;
  passed: boolean;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads the (unverified) claims of the link token; the server verifies its signature. */
export function readLinkClaims(token: string): { sub?: string; payloadHash?: string; exp?: number; iss?: string } | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(json) as Record<string, unknown>;
    return {
      ...(typeof claims['sub'] === 'string' ? { sub: claims['sub'] } : {}),
      ...(typeof claims['payloadHash'] === 'string' ? { payloadHash: claims['payloadHash'] } : {}),
      ...(typeof claims['exp'] === 'number' ? { exp: claims['exp'] } : {}),
      ...(typeof claims['iss'] === 'string' ? { iss: claims['iss'] } : {}),
    };
  } catch {
    return null;
  }
}

export async function runCosignChecks(input: {
  messageId: string;
  token: string;
  payload: EmailPayload;
  payloadHash: string;
  signerCompanyId: string;
  nowSec?: number;
}): Promise<CosignCheck[]> {
  const localHash = await sha256Hex(canonicalize(input.payload));
  const claims = readLinkClaims(input.token);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  return [
    {
      id: 'payload-hash',
      label: 'The wire shown here hashes to the value the sender signed',
      passed: localHash === input.payloadHash,
    },
    {
      id: 'link-binding',
      label: 'Your link is for this exact message',
      passed: claims?.sub === input.messageId && claims?.payloadHash === input.payloadHash,
    },
    {
      id: 'link-expiry',
      label: 'Your link has not expired',
      passed: typeof claims?.exp === 'number' && claims.exp > now,
    },
    {
      id: 'company',
      label: 'The sender is from your company',
      passed: claims?.iss === input.signerCompanyId && input.payload.companyId === input.signerCompanyId,
    },
    {
      id: 'wire',
      label: 'This is a wire instruction with complete details',
      passed: input.payload.isWireInstruction === true && Boolean(input.payload.wirePayload),
    },
  ];
}
