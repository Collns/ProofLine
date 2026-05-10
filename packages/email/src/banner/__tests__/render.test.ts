import { describe, it, expect } from 'vitest';
import { renderEnvelopeBanner, type BannerInput } from '../render.js';
import { STATE_CONFIG } from '../states.js';

const baseInput: Omit<BannerInput, 'state'> = {
  signerName: 'Alice Chen',
  companyName: 'Acme Title',
  companyDomain: 'acme-title.com',
  envelopeId: 'env_abc123',
  verifyBaseUrl: 'https://verify.proofline.web.app',
};

describe('renderEnvelopeBanner — verified state', () => {
  it('contains the verified headline', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'verified' });
    expect(html).toContain(STATE_CONFIG.verified.headline);
  });

  it('contains the verified border color', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'verified' });
    expect(html).toContain(STATE_CONFIG.verified.borderColor);
  });
});

describe('renderEnvelopeBanner — bilateral state', () => {
  it('contains the bilateral headline', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'bilateral' });
    expect(html).toContain(STATE_CONFIG.bilateral.headline);
  });

  it('contains the bilateral border color', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'bilateral' });
    expect(html).toContain(STATE_CONFIG.bilateral.borderColor);
  });
});

describe('renderEnvelopeBanner — suspected_spoof state', () => {
  it('contains the suspected_spoof headline', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'suspected_spoof' });
    expect(html).toContain(STATE_CONFIG.suspected_spoof.headline);
  });

  it('contains the suspected_spoof border color', () => {
    const html = renderEnvelopeBanner({ ...baseInput, state: 'suspected_spoof' });
    expect(html).toContain(STATE_CONFIG.suspected_spoof.borderColor);
  });
});

describe('renderEnvelopeBanner — escaping & URL building', () => {
  it('escapes signerName containing <script> so no literal tag survives', () => {
    const html = renderEnvelopeBanner({
      ...baseInput,
      state: 'verified',
      signerName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('joins verifyBaseUrl + envelopeId with a single slash regardless of trailing slash', () => {
    const withoutSlash = renderEnvelopeBanner({
      ...baseInput,
      state: 'verified',
      verifyBaseUrl: 'https://verify.proofline.web.app',
      envelopeId: 'env_abc123',
    });
    const withSlash = renderEnvelopeBanner({
      ...baseInput,
      state: 'verified',
      verifyBaseUrl: 'https://verify.proofline.web.app/',
      envelopeId: 'env_abc123',
    });
    expect(withoutSlash).toContain(
      'href="https://verify.proofline.web.app/env_abc123"',
    );
    expect(withSlash).toContain(
      'href="https://verify.proofline.web.app/env_abc123"',
    );
    expect(withoutSlash).not.toContain('//env_abc123');
    expect(withSlash).not.toContain('//env_abc123');
  });
});
