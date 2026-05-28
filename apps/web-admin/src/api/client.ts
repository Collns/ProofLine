import {
  ApiError,
  type StartRequest,
  type StartResponse,
  type VerifyDnsRequest,
  type VerifyDnsResponse,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  type VerifyEmailCodeRequest,
  type VerifyEmailCodeResponse,
  type KybRequest,
  type KybResponse,
  type EnrollOfficerRequest,
  type EnrollOfficerResponse,
  type FinalizeRequest,
  type FinalizeResponse,
  type ApiErrorBody,
} from './types';
import {
  sleep,
  fixtureStartResponse,
  fixtureVerifyDnsResponse,
  fixtureVerifyEmailResponse,
  fixtureVerifyEmailCodeResponse,
  fixtureKybResponse,
  fixtureEnrollOfficerResponse,
  fixtureFinalizeResponse,
} from './fixtures';

// PFL-104: a relative '/v1/onboard' path hits Firebase Hosting (which
// serves index.html), not the Functions backend. Point at the deployed
// `api` function; override per-env with VITE_API_BASE.
const API_BASE = import.meta.env.VITE_API_BASE
  ? `${import.meta.env.VITE_API_BASE}/v1/onboard`
  : 'https://us-central1-proofline-cdabb.cloudfunctions.net/api/v1/onboard';
const FIXTURE_LATENCY_MS = 800;

// ── Mode detection ───────────────────────────────────────────────────────────

function isFixtureMode(): boolean {
  // PFL-103: live backend by default so onboarding creates real
  // companies/{} docs in Firestore. Escape hatches for offline UI work:
  //   - ?fixtures=1  query param → force fixtures
  //   - ?live=1      query param → force live (overrides env)
  //   - VITE_USE_FIXTURES=true   build env → force fixtures
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fixtures') === '1') return true;
    if (params.get('live') === '1') return false;
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_USE_FIXTURES;
  return env === 'true' || env === '1';
}

// ── Auth header (stub) ───────────────────────────────────────────────────────
//
// TODO(PFL-AUTH): replace with real Firebase Auth. For this slice, we read a
// token from localStorage at 'firebase-id-token' if present; otherwise fall
// back to a dev placeholder. The real login flow is a separate ticket.

function authHeader(): Record<string, string> {
  const token =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('firebase-id-token')
      : null;
  return { Authorization: `Bearer ${token ?? 'DEV_PLACEHOLDER_TOKEN'}` };
}

// ── Generic POST helper ──────────────────────────────────────────────────────

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

  if (!response.ok) {
    let errBody: ApiErrorBody | undefined;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      // Body wasn't JSON — fall through to generic.
    }
    const code = errBody?.error?.code ?? `HTTP_${response.status}`;
    const message = errBody?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiError(code, response.status, message);
  }

  return (await response.json()) as TRes;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

// PFL-105: resolve the owner's real Firebase UID for the start request.
// The admin app has no Firebase Auth login yet, so we accept the UID via
// (1) ?uid= URL param, or (2) localStorage 'proofline-owner-uid'.
// Returns undefined when neither is set — the server then falls back to
// its stub-auth userId.
function resolveOwnerUid(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromParam = new URLSearchParams(window.location.search).get('uid');
  if (fromParam && fromParam.trim().length > 0) return fromParam.trim();
  const fromStorage = window.localStorage.getItem('proofline-owner-uid');
  if (fromStorage && fromStorage.trim().length > 0) return fromStorage.trim();
  return undefined;
}

export async function startOnboarding(input: StartRequest): Promise<StartResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return { ...fixtureStartResponse, domain: input.domain };
  }
  // Inject the owner UID unless the caller already set one.
  const body: StartRequest = input.ownerUserId
    ? input
    : { ...input, ownerUserId: resolveOwnerUid() };
  return postJson<StartRequest, StartResponse>('/start', body);
}

export async function verifyDns(input: VerifyDnsRequest): Promise<VerifyDnsResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureVerifyDnsResponse;
  }
  return postJson<VerifyDnsRequest, VerifyDnsResponse>('/verify-dns', input);
}

export async function verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureVerifyEmailResponse;
  }
  return postJson<VerifyEmailRequest, VerifyEmailResponse>('/verify-email', input);
}

export async function verifyEmailCode(
  input: VerifyEmailCodeRequest,
): Promise<VerifyEmailCodeResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    // Fixture: any 6-digit code passes; "000000" fails for testing the error UI.
    if (input.code === '000000') {
      throw new ApiError('EMAIL_CODE_INVALID', 422, 'Invalid verification code.');
    }
    return fixtureVerifyEmailCodeResponse;
  }
  return postJson<VerifyEmailCodeRequest, VerifyEmailCodeResponse>(
    '/verify-email-code',
    input,
  );
}

export async function runKyb(input: KybRequest): Promise<KybResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return fixtureKybResponse;
  }
  return postJson<KybRequest, KybResponse>('/kyb', input);
}

export async function enrollOfficer(
  input: EnrollOfficerRequest,
): Promise<EnrollOfficerResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return { ...fixtureEnrollOfficerResponse, officerEmail: input.officerEmail };
  }
  return postJson<EnrollOfficerRequest, EnrollOfficerResponse>(
    '/enroll-officer',
    input,
  );
}

export async function finalize(input: FinalizeRequest): Promise<FinalizeResponse> {
  if (isFixtureMode()) {
    await sleep(FIXTURE_LATENCY_MS);
    return { ...fixtureFinalizeResponse, companyId: input.companyId };
  }
  return postJson<FinalizeRequest, FinalizeResponse>('/finalize', input);
}
