/**
 * PFL-190 #8 — the admin settings page showed the default "Require signing"
 * even when the stored policy was Warn, so a blind Save could overwrite it.
 * Root cause: fetchCompanyProfile dropped unsignedEmailPolicy from the server
 * response. This asserts the mapper now carries the stored policy through, so
 * the page reflects the real value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }),
  getDb: () => ({}),
}));

import { fetchCompanyProfile } from '../admin-data';

const fetchMock = vi.fn();

function companyBody(policy: unknown) {
  return {
    ok: true,
    json: async () => ({
      companyId: 'co-1',
      legalName: 'Acme Title',
      domain: 'acme.com',
      status: 'verified',
      unsignedEmailPolicy: policy,
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCompanyProfile — unsignedEmailPolicy passthrough', () => {
  it('returns the stored Warn policy instead of dropping it', async () => {
    fetchMock.mockResolvedValue(
      companyBody({ mode: 'warn', allowUnsignedOverride: false, appendUnsignedFooter: false }),
    );
    const profile = await fetchCompanyProfile('co-1');
    expect(profile?.unsignedEmailPolicy).toEqual({
      mode: 'warn',
      allowUnsignedOverride: false,
      appendUnsignedFooter: false,
    });
  });

  it('carries an Allow policy through too', async () => {
    fetchMock.mockResolvedValue(
      companyBody({ mode: 'allow', allowUnsignedOverride: true, appendUnsignedFooter: true }),
    );
    const profile = await fetchCompanyProfile('co-1');
    expect(profile?.unsignedEmailPolicy?.mode).toBe('allow');
  });
});
