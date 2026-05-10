import type { VerificationResponse } from './types';
import { FIXTURES, fixtureVerifiedWire } from './fixtures';

const API_BASE = '/v1/verify';

export async function fetchVerification(
  id: string,
  opts?: { mode?: 'live' | 'fixtures' },
): Promise<VerificationResponse> {
  const searchParams = new URLSearchParams(window.location.search);
  const fixtureKey = searchParams.get('fixture');

  const mode = opts?.mode ?? (import.meta.env.DEV ? 'fixtures' : 'live');

  if (mode === 'fixtures' || fixtureKey) {
    const key = fixtureKey ?? 'verified-wire';
    return FIXTURES[key] ?? fixtureVerifiedWire;
  }

  const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Verification API returned ${response.status}`);
  }

  return response.json() as Promise<VerificationResponse>;
}
