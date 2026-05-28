// Request/response shapes for /v1/onboard/* — verified against
// apps/functions/src/api/onboarding/*.handler.ts on main.

export interface StartRequest {
  domain: string;
  legalName: string;
  ein: string;
  state: string;        // 2-char US state code, uppercased
  ownerEmail: string;
  // PFL-105: the real Firebase UID of the owner. The admin app has no
  // Firebase Auth login yet, so the server's stub auth can't supply it —
  // we pass it from the client (URL ?uid= or localStorage) so the company
  // doc records the right owner.
  ownerUserId?: string;
}
export interface StartResponse {
  companyId: string;
  domain: string;
  dnsToken: string;
  txtRecord: string;    // e.g. "proofline-verify=abc123…"
  txtHost: string;      // e.g. "_proofline.acme.com"
}

export interface VerifyDnsRequest {
  companyId: string;
}
export interface VerifyDnsResponse {
  ok: boolean;          // false → still polling; 200 with ok:false
  domain: string;
  status: string;       // OnboardingStatus
  resolvers: string;    // detail string from each resolver
}

export interface VerifyEmailRequest {
  companyId: string;
}
export interface VerifyEmailResponse {
  sent: boolean;
  to: string;
  message: string;
}

export interface VerifyEmailCodeRequest {
  companyId: string;
  code: string;         // 6-digit
}
export interface VerifyEmailCodeResponse {
  ok: boolean;
  status: string;
}

export interface KybRequest {
  companyId: string;
}
export interface KybResponse {
  ok: boolean;
  status: string;
  vendorRef: string;
  officers: { name: string; role: string }[];
}

export interface EnrollOfficerRequest {
  companyId: string;
  officerEmail: string;
}
export interface EnrollOfficerResponse {
  stripeSessionId: string;
  clientSecret: string;
  officerEmail: string;
  message: string;
}

export interface FinalizeRequest {
  companyId: string;
  // PFL-103: skip server-side prior-step gates (onboardingStatus + KYC)
  // so a demo-skipped onboarding can still finalize.
  demoMode?: boolean;
}
export interface FinalizeResponse {
  ok: boolean;
  companyId: string;
  domain: string;
  status: string;
  credentialId: string;
  kmsKeyName: string;
  anchorRoot: string;
  anchorTxHash: string | null;
  anchorBlockNumber: number | null;
  verifiedAt: number;
}

// Generic error body returned by the API's ERR.* helpers.
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
