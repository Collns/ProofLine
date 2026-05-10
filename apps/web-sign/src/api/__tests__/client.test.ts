import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signFresh,
  signSilent,
  signFinalize,
  setExtensionToken,
} from '../client';
import { ApiError } from '../types';

type FetchMock = ReturnType<typeof vi.fn>;

const PAYLOAD = {
  v: 1 as const,
  from: 'sarah@acme.com',
  to: ['vendor@example.com'],
  cc: [] as string[],
  bcc: [] as string[],
  subject: 'Wire instructions',
  body: 'See attached',
  isWireInstruction: false,
  issuedAt: 1700000000,
  expiresAt: 1700003600,
  nonce: 'nonce-fixture-min-22-chars',
  companyId: 'co-1',
};

function mockFetch(response: { ok: boolean; status?: number; body: unknown }): FetchMock {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.body,
  }) as unknown as Response);
}

describe('client.signFresh', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setExtensionToken('test-ext-token');
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs /v1/sign with the spec body shape and Bearer token', async () => {
    const fetchMock = mockFetch({
      ok: true,
      body: { ok: true, policyDecision: 'APPROVED', challenge: { challenge: 'c', rpId: 'r', allowCredentials: [], userVerification: 'required', timeout: 60000 } },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await signFresh({
      payload: PAYLOAD,
      recipientSetHash: 'a'.repeat(64),
      credentialId: 'cred-1',
      freshBiometric: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/sign$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer test-ext-token');
    const body = JSON.parse(init.body as string);
    expect(body.freshBiometric).toBe(true);
    expect(body.recipientSetHash).toHaveLength(64);
    expect(body.payload.subject).toBe('Wire instructions');
  });
});

describe('client.signSilent', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setExtensionToken('test-ext-token');
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs /v1/sign-silent with sessionToken in the body', async () => {
    const fetchMock = mockFetch({
      ok: true,
      body: { ok: true, challenge: { challenge: 'c', rpId: 'r', allowCredentials: [], userVerification: 'discouraged', timeout: 60000 } },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await signSilent({
      sessionToken: 'jws.payload.sig',
      payload: PAYLOAD,
      recipientSetHash: 'b'.repeat(64),
      credentialId: 'cred-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/sign-silent$/);
    const body = JSON.parse(init.body as string);
    expect(body.sessionToken).toBe('jws.payload.sig');
    expect(body.recipientSetHash).toHaveLength(64);
  });
});

describe('client.signFinalize', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setExtensionToken('test-ext-token');
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs /v1/sign/finalize with assertion, payloadHash, path, and X-Proofline-Challenge-Id header', async () => {
    const fetchMock = mockFetch({
      ok: true,
      body: { ok: true, envelope: {}, banner: '<div/>', sessionToken: 'new.jws.sig' },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await signFinalize(
      {
        assertion: { credentialId: 'cred-1', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig' },
        payloadHash: 'c'.repeat(64),
        recipientSetHash: 'd'.repeat(64),
        path: 'fresh',
      },
      'cer-abc',
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/sign\/finalize$/);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Proofline-Challenge-Id']).toBe('cer-abc');
    const body = JSON.parse(init.body as string);
    expect(body.path).toBe('fresh');
    expect(body.payloadHash).toHaveLength(64);
    expect(body.assertion.credentialId).toBe('cred-1');
  });

  it('surfaces non-2xx responses as ApiError with code from RFC7807 body', async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 401,
      body: { type: 'https://proofline.app/errors/SESSION_INVALID', title: 'SESSION_INVALID', status: 401, detail: 'Session token JWS verification failed' },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      signFinalize(
        {
          assertion: { credentialId: 'cred-1', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig' },
          payloadHash: 'c'.repeat(64),
          recipientSetHash: 'd'.repeat(64),
          path: 'silent',
          sessionToken: 'jws.payload.sig',
        },
        'cer-abc',
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
