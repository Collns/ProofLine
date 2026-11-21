/**
 * PFL-190 #6 — the in-email signed card (renderBanner / renderBannerFromEnvelope):
 *   a. shows a "Test company" warning when the signer's company is a test company;
 *   b. never claims the message is already anchored at send time.
 */

import { describe, it, expect } from 'vitest';
import { renderBanner, renderBannerFromEnvelope, type SignerDisplayRecord } from '../banner.js';

const signer = {
  name: 'Alice Chen',
  role: 'Owner',
  companyName: 'Acme Title',
  domain: 'acme-title.com',
  signedAt: Date.UTC(2026, 0, 2, 15, 4),
};

describe('6a — Test company label', () => {
  it('renders the Test company warning (matching the verify page) when testCompany', () => {
    const html = renderBanner({
      envelopeId: 'env_abc123',
      state: 'verified',
      signers: [signer],
      isWireInstruction: false,
      testCompany: true,
    });
    expect(html).toContain('Test company');
    expect(html).toMatch(/sender-domain checks are relaxed/i);
  });

  it('omits the Test company warning for a normal company', () => {
    const html = renderBanner({
      envelopeId: 'env_abc123',
      state: 'verified',
      signers: [signer],
      isWireInstruction: false,
    });
    expect(html).not.toContain('Test company');
  });

  it('renderBannerFromEnvelope derives testCompany from the signer records', () => {
    const envelope = {
      envelopeId: 'env_abc123',
      status: 'SIGNED' as const,
      signatures: [{ signerId: 'u-1', signedAt: signer.signedAt }],
      payload: { isWireInstruction: false },
    };
    const records: SignerDisplayRecord[] = [
      { userId: 'u-1', ...signer, testCompany: true },
    ];
    expect(renderBannerFromEnvelope(envelope, records)).toContain('Test company');

    const normal: SignerDisplayRecord[] = [{ userId: 'u-1', ...signer }];
    expect(renderBannerFromEnvelope(envelope, normal)).not.toContain('Test company');
  });
});

describe('6b — anchor wording is truthful at send time', () => {
  it('says "Anchoring on Base", not "Anchored on Base"', () => {
    const html = renderBanner({
      envelopeId: 'env_abc123',
      state: 'verified',
      signers: [signer],
      isWireInstruction: false,
    });
    expect(html).toContain('Anchoring on Base');
    expect(html).not.toContain('Anchored on Base');
    expect(html).toMatch(/verify link/i);
  });
});
