import type { VerificationResponse } from './types';

const NOW_SEC = Math.floor(Date.now() / 1000);

export const fixtureVerifiedWire: VerificationResponse = {
  ok: true,
  state: 'verified',
  signers: [
    {
      userId: 'user-sarah-chen',
      credentialId: 'cred-sarah-chen-001',
      role: 'manager',
      sig: 'MEQCIBz3H1q2P9vKlmnop',
      signedAt: NOW_SEC - 120,
      sessionId: 'sess-abc123',
      companyId: 'acme-title',
      companyDomain: 'acme-title.com',
      companyLegalName: 'Acme Title LLC',
      userDisplayName: 'Sarah Chen',
    },
  ],
  payload: {
    v: 1,
    amount: 25000000,
    currency: 'USD',
    recipientAccount: '••••7842',
    recipientRouting: '021000021',
    memo: 'Escrow disbursement – 742 Maple Street closing',
    reference: 'REF-2026-05-10-001',
  },
  anchor: {
    root: '0xa3f7c8d2e1b4509f6a78cd3b92e145f0a8d3c7b1e2f9045678abcdef1234567',
    blockNumber: '12847392',
    timestamp: String(NOW_SEC - 300),
  },
};

export const fixtureVerifiedEmail: VerificationResponse = {
  ok: true,
  state: 'verified',
  signers: [
    {
      userId: 'user-sarah-chen',
      credentialId: 'cred-sarah-chen-001',
      role: 'manager',
      sig: 'MEQCIAbc1D2e3F4g5Hijk',
      signedAt: NOW_SEC - 60,
      sessionId: 'sess-xyz789',
      companyId: 'acme-title',
      companyDomain: 'acme-title.com',
      companyLegalName: 'Acme Title LLC',
      userDisplayName: 'Sarah Chen',
    },
  ],
  payload: {
    v: 1,
    from: 'sarah.chen@acme-title.com',
    to: ['james.whitfield@firstnational.com'],
    cc: [],
    bcc: [],
    subject: 'Closing documents ready for 742 Maple Street',
    body: 'Hi James,\n\nThe closing package for 742 Maple Street is ready for your review. Please see the attached wire instructions.\n\nBest,\nSarah',
    isWireInstruction: false,
    issuedAt: NOW_SEC - 300,
    expiresAt: NOW_SEC + 3300,
    nonce: 'nonce-verified-email-fixture-01',
    companyId: 'acme-title',
  },
  anchor: {
    root: '0xb4e8d1f2a3c5607e9b81de4c03f256a1b9e4d8c2f3a70567891abcdef234568',
    blockNumber: '12847450',
    timestamp: String(NOW_SEC - 180),
  },
};

export const fixtureBilateralBanking: VerificationResponse = {
  ok: true,
  state: 'bilateral',
  signers: [
    {
      userId: 'user-sarah-chen',
      credentialId: 'cred-sarah-chen-001',
      role: 'manager',
      sig: 'MEQCIBDrafter1Sig',
      signedAt: NOW_SEC - 3600,
      sessionId: 'sess-bilateral-drafter',
      companyId: 'acme-title',
      companyDomain: 'acme-title.com',
      companyLegalName: 'Acme Title LLC',
      userDisplayName: 'Sarah Chen',
    },
    {
      userId: 'user-james-whitfield',
      credentialId: 'cred-james-whitfield-001',
      role: 'owner',
      sig: 'MEQCIBCounterparty1Sig',
      signedAt: NOW_SEC - 1800,
      sessionId: 'sess-bilateral-cpty',
      companyId: 'first-national',
      companyDomain: 'firstnational.com',
      companyLegalName: 'First National Bank',
      userDisplayName: 'James Whitfield',
    },
  ],
  payload: {
    v: 1,
    docId: 'doc-banking-change-2026-001',
    docType: 'banking_change',
    drafterCompanyId: 'acme-title',
    counterpartyCompanyId: 'first-national',
    content: {
      description: 'Updated wire disbursement account for escrow closings',
      previousAccountLast4: '3821',
      newAccountLast4: '7842',
      routingNumber: '021000021',
      effectiveDate: '2026-05-15',
    },
    issuedAt: NOW_SEC - 86400,
    expiresAt: NOW_SEC + 1209600,
    nonce: 'nonce-bilateral-banking-fixture-01',
  },
  anchor: {
    root: '0xc5f9e2a3b4d6718f0c92ef5d14a367b2c0f5e9d3a4b8167890abcdef345679',
    blockNumber: '12840000',
    timestamp: String(NOW_SEC - 86400),
  },
};

export const fixtureSuspectedSpoof: VerificationResponse = {
  ok: true,
  state: 'suspected_spoof',
  claimedCompany: {
    companyId: 'acme-title',
    domain: 'acme-title.com',
    legalName: 'Acme Title LLC',
  },
  detail:
    'Message claims to originate from the verified ProofLine sender acme-title.com, but no valid cryptographic signature was found covering this message content.',
};

export const fixtureRejectedTampered: VerificationResponse = {
  ok: false,
  state: 'rejected',
  code: 'PAYLOAD_HASH_MISMATCH',
  detail:
    'The message content does not match the signed hash. The payload may have been modified in transit.',
};

export const fixtureRejectedExpired: VerificationResponse = {
  ok: false,
  state: 'rejected',
  code: 'PAYLOAD_EXPIRED',
  detail:
    'This message carried a validity window that has now passed. The signature is no longer considered current.',
};

export const fixtureUnverifiedSender: VerificationResponse = {
  ok: true,
  state: 'unverified_sender',
};

export const FIXTURES: Record<string, VerificationResponse> = {
  'verified-wire': fixtureVerifiedWire,
  'verified-email': fixtureVerifiedEmail,
  'bilateral-banking': fixtureBilateralBanking,
  'suspected-spoof': fixtureSuspectedSpoof,
  'rejected-tampered': fixtureRejectedTampered,
  'rejected-expired': fixtureRejectedExpired,
  'unverified-sender': fixtureUnverifiedSender,
};
