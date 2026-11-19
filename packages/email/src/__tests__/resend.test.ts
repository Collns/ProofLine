/**
 * PFL-160 — Resend templates escape every caller-supplied value so a memo,
 * company name or document type can't inject markup into a ProofLine email.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ subject: string; html: string; text?: string; to: string[] }> = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: vi.fn(async (input: { subject: string; html: string; text?: string; to: string[] }) => {
        sent.push(input);
        return { data: { id: `em_${sent.length}` }, error: null };
      }),
    };
  },
}));

import { makeResendProvider, escapeHtml } from '../providers/resend.js';

const EVIL = '<img src=x onerror="alert(1)"><a href="https://evil.example">click</a>';

beforeEach(() => { sent.length = 0; });

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<b class="x">'&'</b>`)).toBe('&lt;b class=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
  });
});

describe('makeResendProvider templates', () => {
  const provider = makeResendProvider({ apiKey: 're_test', fromDomain: 'mail.proofline.test' });

  it('escapes the wire memo and fields in cosign requests', async () => {
    await provider.sendCosignRequest(
      ['approver@acme.test'],
      { amount: 40_000_000, recipientAccountLast4: '7842', routingNumber: '026005092', memo: EVIL },
      'https://proofline-counterparty.web.app/cosign/msg-1?t=a"b',
    );
    const { html, subject } = sent[0]!;
    expect(subject).toBe('Co-sign request: $400000.00');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('href="https://proofline-counterparty.web.app/cosign/msg-1?t=a&quot;b"');
  });

  it('escapes company and document names in bilateral and invitation emails', async () => {
    await provider.sendBilateralRequest(
      'cp@scotia.test',
      { documentId: 'd1', documentType: EVIL, drafterName: EVIL, drafterCompany: EVIL },
      'https://portal.test/b/d1?t=x',
    );
    await provider.sendInvitation('bob@scotia.test', EVIL, 'tok/../x');
    for (const { html } of sent) {
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<a href="https://evil.example"');
    }
    expect(sent[1]!.html).toContain('/invite/tok%2F..%2Fx');
  });
});
