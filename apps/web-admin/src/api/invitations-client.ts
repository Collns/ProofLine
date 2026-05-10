import { ApiError, type ApiErrorBody } from './types';
import type {
  Invitation,
  InvitationInput,
  BulkInvitationInput,
  BulkInvitationResult,
  ListInvitationsOptions,
  ListInvitationsResult,
  NetworkStats,
  BulkSkipReason,
} from './invitations-types';
import {
  fixtureListInvitations,
  fixtureGetInvitation,
  fixtureNetworkStats,
  fixtureCreateInvitation,
  fixtureCancelInvitation,
  fixtureResendInvitation,
  getFixtureStore,
} from './invitations-fixtures';
import { sleep } from './fixtures';

const API_BASE = '/v1/invitations';
const FIXTURE_LATENCY_MS = 600;

// Bulk constraints from PRD §6.7 F-INV-06.
export const BULK_LIMIT = 100;

// Domain we treat as "self" in fixture mode — matches the wizard fixture.
const SELF_DOMAIN_FIXTURE = 'acme-title.com';

// ── Mode detection ───────────────────────────────────────────────────────────

function isFixtureMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('fixture') === 'happy-path') return true;
  if (import.meta.env.DEV && !window.localStorage.getItem('firebase-id-token')) {
    return true;
  }
  return false;
}

// ── Auth header (stub, mirrors client.ts) ────────────────────────────────────

function authHeader(): Record<string, string> {
  const token =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('firebase-id-token')
      : null;
  return { Authorization: `Bearer ${token ?? 'DEV_PLACEHOLDER_TOKEN'}` };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function getJson<TRes>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<TRes> {
  const qs = query
    ? `?${new URLSearchParams(
        Object.entries(query).reduce<Record<string, string>>((acc, [k, v]) => {
          if (v !== undefined && v !== null && v !== '') {
            acc[k] = String(v);
          }
          return acc;
        }, {}),
      ).toString()}`
    : '';

  const response = await fetch(`${API_BASE}${path}${qs}`, {
    method:  'GET',
    headers: { Accept: 'application/json', ...authHeader() },
  });
  return parseResponse<TRes>(response);
}

async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const response = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...authHeader(),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<TRes>(response);
}

async function deleteJson(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method:  'DELETE',
    headers: { Accept: 'application/json', ...authHeader() },
  });
  if (!response.ok) {
    let errBody: ApiErrorBody | undefined;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      /* fall through */
    }
    const code = errBody?.error?.code ?? `HTTP_${response.status}`;
    const message =
      errBody?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }
}

async function parseResponse<TRes>(response: Response): Promise<TRes> {
  if (!response.ok) {
    let errBody: ApiErrorBody | undefined;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      /* fall through */
    }
    const code = errBody?.error?.code ?? `HTTP_${response.status}`;
    const message =
      errBody?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }
  return (await response.json()) as TRes;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function listInvitations(
  opts: ListInvitationsOptions = {},
): Promise<ListInvitationsResult> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureListInvitations(opts);
  }
  return getJson<ListInvitationsResult>('', {
    status:   opts.status,
    page:     opts.page,
    pageSize: opts.pageSize,
    search:   opts.search,
  });
}

export async function getInvitation(id: string): Promise<Invitation | null> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureGetInvitation(id);
  }
  try {
    return await getJson<Invitation>(`/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.httpStatus === 404) return null;
    throw err;
  }
}

export async function createInvitation(
  input: InvitationInput,
): Promise<Invitation> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureCreateInvitation(input.email, {
      sponsoredCost: input.sponsoredCost,
      message:       input.message,
    });
  }
  return postJson<InvitationInput, Invitation>('', input);
}

export async function bulkCreateInvitations(
  input: BulkInvitationInput,
): Promise<BulkInvitationResult> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return runFixtureBulk(input);
  }
  return postJson<BulkInvitationInput, BulkInvitationResult>('/bulk', input);
}

export async function resendInvitation(id: string): Promise<Invitation> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    const updated = fixtureResendInvitation(id);
    if (!updated) {
      throw new ApiError('NOT_FOUND', 404, 'Invitation not found.');
    }
    return updated;
  }
  return postJson<Record<string, never>, Invitation>(
    `/${encodeURIComponent(id)}/resend`,
    {},
  );
}

export async function cancelInvitation(id: string): Promise<void> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    fixtureCancelInvitation(id);
    return;
  }
  await deleteJson(`/${encodeURIComponent(id)}`);
}

export async function getNetworkStats(): Promise<NetworkStats> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureNetworkStats();
  }
  return getJson<NetworkStats>('/stats');
}

// ── Fixture-mode bulk dedupe (mirrors expected server behaviour) ─────────────

function runFixtureBulk(input: BulkInvitationInput): BulkInvitationResult {
  const created: Invitation[] = [];
  const skipped: { email: string; reason: BulkSkipReason }[] = [];
  const seenInBatch = new Set<string>();
  const existing = new Set(
    getFixtureStore()
      .filter((i) => i.status === 'sent' || i.status === 'accepted')
      .map((i) => i.email.toLowerCase()),
  );

  for (const raw of input.emails) {
    const email = raw.trim();
    const lower = email.toLowerCase();

    if (created.length + skipped.length >= BULK_LIMIT) {
      skipped.push({ email, reason: 'over_limit' });
      continue;
    }
    if (!isPlausibleEmail(email)) {
      skipped.push({ email, reason: 'invalid_email' });
      continue;
    }
    if (seenInBatch.has(lower)) {
      skipped.push({ email, reason: 'duplicate_in_batch' });
      continue;
    }
    if (lower.endsWith(`@${SELF_DOMAIN_FIXTURE}`)) {
      skipped.push({ email, reason: 'self_domain' });
      continue;
    }
    if (existing.has(lower)) {
      skipped.push({ email, reason: 'already_invited' });
      continue;
    }

    seenInBatch.add(lower);
    existing.add(lower);
    created.push(
      fixtureCreateInvitation(email, {
        sponsoredCost: input.sponsoredCost,
        message:       input.message,
      }),
    );
  }

  return { created, skipped };
}

function isPlausibleEmail(email: string): boolean {
  // Pragmatic regex — same shape as the BulkEmailParser uses client-side.
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email);
}