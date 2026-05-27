import type { VerificationResponse } from './types';
import { FIXTURES, fixtureVerifiedWire } from './fixtures';

// Absolute origin of the deployed Firebase Functions `api` HTTP function.
// The verify page is hosted on its own Firebase subdomain that has no
// /v1/* rewrites, so we point straight at the function URL. Overridable
// via VITE_API_BASE at build time for emulator / staging runs.
const DEFAULT_API_BASE = 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
const API_ORIGIN = (
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE
).replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/v1/verify`;

export async function fetchVerification(
  id: string,
  opts?: { mode?: 'live' | 'fixtures' },
): Promise<VerificationResponse> {
  const searchParams = new URLSearchParams(window.location.search);
  const fixtureKey = searchParams.get('fixture');

  const mode = opts?.mode ?? 'live';

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
