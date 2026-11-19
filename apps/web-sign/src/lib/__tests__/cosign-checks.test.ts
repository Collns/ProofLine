import { describe, it, expect } from 'vitest';
import { canonicalize } from '@proofline/canonical';
import type { EmailPayload } from '@proofline/types';
import { runCosignChecks, sha256Hex, readLinkClaims } from '../cosign-checks';

const payload: EmailPayload = {
  v: 1, from: 'sarah@acme-title.com', to: ['mark@scotia.example'], cc: [], bcc: [],
  subject: 'Wire', body: 'Please wire.', isWireInstruction: true,
  wirePayload: { v: 1, amount: 25_000, currency: 'USD', recipientAccount: 'XXXX7842', recipientRouting: '026005092' },
  issuedAt: 1, expiresAt: 2, nonce: 'n'.repeat(22), companyId: 'acme-title',
};

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

describe('runCosignChecks', () => {
  it('passes when the payload, link and company all line up', async () => {
    const hash = await sha256Hex(canonicalize(payload));
    const token = tokenFor({ iss: 'acme-title', sub: 'msg-1', payloadHash: hash, exp: 2_000 });
    const checks = await runCosignChecks({ messageId: 'msg-1', token, payload, payloadHash: hash, signerCompanyId: 'acme-title', nowSec: 1_000 });
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it('fails when the shown payload was altered, the link is for another message, or it expired', async () => {
    const hash = await sha256Hex(canonicalize(payload));
    const altered = { ...payload, wirePayload: { ...payload.wirePayload!, recipientAccount: 'XXXX0000' } };
    const token = tokenFor({ iss: 'acme-title', sub: 'msg-other', payloadHash: hash, exp: 500 });
    const checks = await runCosignChecks({ messageId: 'msg-1', token, payload: altered, payloadHash: hash, signerCompanyId: 'acme-title', nowSec: 1_000 });
    const failed = checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(['payload-hash', 'link-binding', 'link-expiry']);
  });

  it('reads claims defensively', () => {
    expect(readLinkClaims('garbage')).toBeNull();
    expect(readLinkClaims(tokenFor({ sub: 'm', exp: 5 }))).toEqual({ sub: 'm', exp: 5 });
  });
});
