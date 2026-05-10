import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCosignContext, finalizeCosign, requestFreshLink } from '../client';

const fakeWindow = { location: { search: '' } } as Pick<Window, 'location'>;

describe('cosign API client (live mode)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getCosignContext issues GET to /v1/cosign/{id}?token=… with token URL-encoded', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messageId: 'msg-A' }),
    } as unknown as Response);

    await getCosignContext(
      { messageId: 'msg-A', token: 'a.b.c?d=1' },
      { mode: 'live', window: fakeWindow },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/cosign/msg-A?token=a.b.c%3Fd%3D1');
    expect(init).toMatchObject({
      headers: { Accept: 'application/json' },
    });
  });

  it('finalizeCosign POSTs JSON body with assertion + challenge and the token in a custom header', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messageId: 'msg-A', anchorWillFollow: true }),
    } as unknown as Response);

    const payload = {
      assertion: { id: 'ass', rawId: 'r', response: {}, type: 'public-key' },
      challenge: 'chal-bytes',
    };

    await finalizeCosign(
      { messageId: 'msg-A', token: 'tok', payload },
      { mode: 'live', window: fakeWindow },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/cosign/msg-A/finalize');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-ProofLine-Cosign-Token': 'tok',
    });
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('surfaces network errors as a typed Result error', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    const res = await getCosignContext(
      { messageId: 'm', token: 't' },
      { mode: 'live', window: fakeWindow },
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NETWORK_ERROR');
    expect(res.detail).toContain('connection refused');
  });

  it('requestFreshLink POSTs token in body to /v1/cosign/{id}/refresh', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, freshLinkSent: true }),
    } as unknown as Response);

    await requestFreshLink(
      { messageId: 'msg-X', token: 'tok-Y' },
      { mode: 'live', window: fakeWindow },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/cosign/msg-X/refresh');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-Y' });
  });

  it('returns server-error envelope verbatim when fetch resolves !ok with body.code', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ ok: false, code: 'COSIGN_LINK_EXPIRED', detail: 'expired 5m ago' }),
    } as unknown as Response);

    const res = await getCosignContext(
      { messageId: 'm', token: 't' },
      { mode: 'live', window: fakeWindow },
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('COSIGN_LINK_EXPIRED');
  });
});

describe('cosign API client (fixtures mode)', () => {
  it('returns the named fixture when ?fixture= is set on window.location', async () => {
    const winWithFixture = { location: { search: '?fixture=expired' } } as Pick<Window, 'location'>;
    const res = await getCosignContext(
      { messageId: 'anything', token: 'anything' },
      { window: winWithFixture },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('COSIGN_LINK_EXPIRED');
  });
});
