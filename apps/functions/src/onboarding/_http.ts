import type { Request } from 'firebase-functions/v2/https';
import type { OnboardingError } from '@proofline/onboarding';

// Structural minimum we use from express.Response, avoiding an @types/express
// dep. firebase-functions hands us an express.Response but we don't need its
// full surface here.
interface Response {
  status(code: number): Response;
  json(body: unknown): Response;
}

export function statusFor(code: OnboardingError['code']): number {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'BAD_STATE': return 409;
    case 'CODE_INVALID':
    case 'DNS_NOT_FOUND': return 400;
    case 'LOCKED_OUT': return 429;
    case 'KYB_REJECTED':
    case 'KYB_REVIEW':
    case 'KYC_FAILED': return 422;
    case 'KMS_FAILED':
    case 'ANCHOR_FAILED': return 502;
    case 'INTERNAL':
    default: return 500;
  }
}

export function sendOk(res: Response, value: unknown): void {
  res.status(200).json(value);
}

export function sendErr(res: Response, error: OnboardingError): void {
  res.status(statusFor(error.code)).json({
    type: error.code,
    detail: error,
  });
}

export function sendBadRequest(res: Response, detail: string): void {
  res.status(400).json({ type: 'BAD_REQUEST', detail });
}

export function ensurePost(req: Request, res: Response): boolean {
  if (req.method !== 'POST') {
    res.status(405).json({ type: 'METHOD_NOT_ALLOWED' });
    return false;
  }
  return true;
}
