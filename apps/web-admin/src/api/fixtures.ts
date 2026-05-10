import type {
  StartResponse,
  VerifyDnsResponse,
  VerifyEmailResponse,
  VerifyEmailCodeResponse,
  KybResponse,
  EnrollOfficerResponse,
  FinalizeResponse,
} from './types';

// Synthetic happy-path fixtures keyed to a single companyId.
// Used when ?fixture=happy-path is set (or implicitly in DEV with no API).

const FIX_COMPANY_ID = 'co_fixture_acme_title';
const FIX_DNS_TOKEN  = '7f3a2b1c9e8d4506a7b2c3d4e5f6a7b8';

export const fixtureStartResponse: StartResponse = {
  companyId: FIX_COMPANY_ID,
  domain:    'acme-title.com',
  dnsToken:  FIX_DNS_TOKEN,
  txtRecord: `proofline-verify=${FIX_DNS_TOKEN}`,
  txtHost:   '_proofline.acme-title.com',
};

export const fixtureVerifyDnsResponse: VerifyDnsResponse = {
  ok:        true,
  domain:    'acme-title.com',
  status:    'pending_email',
  resolvers: 'cloudflare-1.1.1.1: ok; google-8.8.8.8: ok; quad9-9.9.9.9: ok',
};

export const fixtureVerifyEmailResponse: VerifyEmailResponse = {
  sent:    true,
  to:      'owner@acme-title.com',
  message: 'Verification code sent. Expires in 10 minutes.',
};

export const fixtureVerifyEmailCodeResponse: VerifyEmailCodeResponse = {
  ok:     true,
  status: 'pending_kyb',
};

export const fixtureKybResponse: KybResponse = {
  ok:        true,
  status:    'pending_kyc',
  vendorRef: 'biz_01HXY9Z3K2VFR4Q8P5MN7B6T',
  officers:  [
    { name: 'Alice Chen',      role: 'CEO' },
    { name: 'Daniel Vasquez',  role: 'CFO' },
  ],
};

export const fixtureEnrollOfficerResponse: EnrollOfficerResponse = {
  stripeSessionId: 'vs_1QNzLkAbcDef0123456789',
  clientSecret:    'cs_test_FIXTURE_DO_NOT_USE_FOR_REAL',
  officerEmail:    'alice@acme-title.com',
  message:         'Embed the Stripe Identity widget using clientSecret. Verification result arrives via webhook.',
};

export const fixtureFinalizeResponse: FinalizeResponse = {
  ok:                true,
  companyId:         FIX_COMPANY_ID,
  domain:            'acme-title.com',
  status:            'verified',
  credentialId:      'rc_01HXY9Z3K2VFR4Q8P5MN7B6T01',
  kmsKeyName:        `projects/proofline-prod/locations/global/keyRings/proofline/cryptoKeys/company-${FIX_COMPANY_ID}`,
  anchorRoot:        '0xa3f7c8d2e1b4509f6a78cd3b92e145f0a8d3c7b1e2f9045678abcdef1234567',
  anchorTxHash:      '0xb4e8d1f2a3c5607e9b81de4c03f256a1b9e4d8c2f3a70567891abcdef234568',
  anchorBlockNumber: 12847500,
  verifiedAt:        Date.now(),
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
