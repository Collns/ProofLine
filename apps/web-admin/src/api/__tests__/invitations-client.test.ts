import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bulkCreateInvitations,
  cancelInvitation,
  listInvitations,
} from '../invitations-client';
import { ApiError } from '../types';

// The client's isFixtureMode() returns false when `typeof window === 'undefined'`
// (vitest's default node environment), so these tests exercise the real
// fetch path with a stubbed global fetch.

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function mockResponse({ status = 200, body = {} }: MockResponseInit = {}): Response {
  return {
    ok:    status >= 200 && status < 300,
    status,
    json:  async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listInvitations', () => {
  it('encodes status, page, pageSize, and search into the query string', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ body: { items: [], total: 0, page: 2, pageSize: 25 } }),
    );

    await listInvitations({
      status:   'sent',
      page:     2,
      pageSize: 25,
      search:   'scotia',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(typeof url).toBe('string');
    expect(url).toContain('/v1/invitations');
    expect(url).toContain('status=sent');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=25');
    expect(url).toContain('search=scotia');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({ Accept: 'application/json' });
  });

  it('omits empty/undefined query params', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ body: { items: [], total: 0, page: 1, pageSize: 25 } }),
    );

    await listInvitations({});

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('status=');
    expect(url).not.toContain('search=');
  });
});

describe('bulkCreateInvitations', () => {
  it('passes the server-shaped result through, including skipped reasons', async () => {
    const serverBody = {
      created: [
        {
          id: 'inv_a',
          inviterCompanyId: 'co_x',
          inviterCompanyName: 'Acme',
          email: 'ok@example.com',
          status: 'sent',
          sponsoredCost: false,
          message: null,
          sentAt: 1,
          expiresAt: 2,
          acceptedAt: null,
          cancelledAt: null,
          acceptingCompanyId: null,
          acceptingCompanyName: null,
        },
      ],
      skipped: [
        { email: 'dup@example.com', reason: 'duplicate_in_batch' },
        { email: 'old@example.com', reason: 'already_invited' },
      ],
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ body: serverBody }));

    const result = await bulkCreateInvitations({
      emails: ['ok@example.com', 'dup@example.com', 'old@example.com'],
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].email).toBe('ok@example.com');
    expect(result.skipped).toEqual([
      { email: 'dup@example.com', reason: 'duplicate_in_batch' },
      { email: 'old@example.com', reason: 'already_invited' },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/invitations/bulk');
    expect((init as RequestInit).method).toBe('POST');
  });
});

describe('error handling', () => {
  it('surfaces structured error bodies as ApiError with code, status, and message', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 422,
        body:   { error: { code: 'INVALID_EMAIL', message: 'That email is malformed.' } },
      }),
    );

    await expect(cancelInvitation('inv_bad')).rejects.toMatchObject({
      name:       'ApiError',
      code:       'INVALID_EMAIL',
      httpStatus: 422,
      message:    'That email is malformed.',
    });
  });

  it('falls back to HTTP_<status> code when no error body is parseable', async () => {
    fetchMock.mockResolvedValueOnce({
      ok:     false,
      status: 500,
      json:   async () => { throw new Error('not json'); },
    } as unknown as Response);

    let caught: unknown;
    try {
      await listInvitations({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ code: 'HTTP_500', httpStatus: 500 });
  });
});
