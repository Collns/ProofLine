import { describe, it, expect } from 'vitest';
import { resolveDomainStatus } from '../domain-status.js';
import type { RegistryView, Company, Hex32 } from '../types.js';

const acme: Company = {
  companyId: 'acme',
  domain: 'acme-title.com',
  legalName: 'Acme Title Inc.',
  rootPublicKey: 'fake-root-key',
  status: 'verified',
  verifiedAt: 1700000000,
};

function makeRegistryWithCompany(company: Company | null): RegistryView {
  return {
    getCompany: async () => null,
    getCompanyByDomain: async (domain: string) =>
      company && domain === company.domain ? company : null,
    getUser: async () => null,
    getUserCredential: async () => null,
    isRevoked: async () => false,
    isNonceUsed: async () => false,
    getLatestAnchor: async () => null,
    getAnchorForRoot: async (_root: Hex32) => null,
  };
}

describe('resolveDomainStatus', () => {
  it('returns unknown_sender when domain is not in the registry', async () => {
    const view = makeRegistryWithCompany(null);
    const result = await resolveDomainStatus(
      { senderDomain: 'random-domain.com', hasEnvelope: false },
      view,
    );
    expect(result.state).toBe('unknown_sender');
  });

  it('returns has_envelope when domain is verified and email carried a signature', async () => {
    const view = makeRegistryWithCompany(acme);
    const result = await resolveDomainStatus(
      { senderDomain: 'acme-title.com', hasEnvelope: true },
      view,
    );
    expect(result.state).toBe('has_envelope');
  });

  it('returns suspected_spoof with company info when domain is verified but no signature was attached', async () => {
    const view = makeRegistryWithCompany(acme);
    const result = await resolveDomainStatus(
      { senderDomain: 'acme-title.com', hasEnvelope: false },
      view,
    );
    expect(result.state).toBe('suspected_spoof');
    if (result.state === 'suspected_spoof') {
      expect(result.company.name).toBe('Acme Title Inc.');
      expect(result.company.domain).toBe('acme-title.com');
    }
  });

  it('normalizes mixed-case sender domain to match stored lowercase domain', async () => {
    const view = makeRegistryWithCompany(acme);
    const result = await resolveDomainStatus(
      { senderDomain: 'ACME-TITLE.com', hasEnvelope: false },
      view,
    );
    expect(result.state).toBe('suspected_spoof');
  });

  it('returns unknown_sender for empty or whitespace-only senderDomain', async () => {
    const view = makeRegistryWithCompany(acme);
    const empty = await resolveDomainStatus(
      { senderDomain: '', hasEnvelope: false },
      view,
    );
    const whitespace = await resolveDomainStatus(
      { senderDomain: '   ', hasEnvelope: false },
      view,
    );
    expect(empty.state).toBe('unknown_sender');
    expect(whitespace.state).toBe('unknown_sender');
  });
});
