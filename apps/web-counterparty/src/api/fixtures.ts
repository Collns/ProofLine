import type { CosignContextResponse, FinalizeCosignResponse, RefreshLinkResponse } from './types';

const NOW_SEC = Math.floor(Date.now() / 1000);

const SARAH = {
  userId: 'user-sarah-chen',
  credentialId: 'cred-sarah-chen-001',
  userDisplayName: 'Sarah Chen',
  companyId: 'acme-title',
  companyDomain: 'acme-title.com',
  companyLegalName: 'Acme Title LLC',
  signedAt: NOW_SEC - 90,
};

const WIRE_PAYLOAD = {
  v: 1 as const,
  amount: 40000000,                       // $400,000.00 in cents
  currency: 'USD' as const,
  recipientAccount: '••••7842',
  recipientRouting: '026005092',          // valid 9-digit Scotia
  memo: 'Escrow disbursement — 742 Maple Street closing',
  reference: 'REF-2026-05-10-WIRE',
};

// Synthetic — server computes the real one. Tests verify recompute matches.
const PAYLOAD_HASH_READY    = '0fbb4cdcc8b6e2d2cebf7f7dd3a9eba8e2d8f9d1cdba51e4a22f0f1d2e3a4b5c';
const PAYLOAD_HASH_TAMPERED = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888';

export const fixtureReady: CosignContextResponse = {
  ok: true,
  messageId: 'msg-demo-cosign-001',
  envelope: {
    v: 1,
    payloadType: 'wire',
    payload: WIRE_PAYLOAD,
    payloadHash: PAYLOAD_HASH_READY,
    signers: [
      {
        userId: SARAH.userId,
        credentialId: SARAH.credentialId,
        role: 'manager',
        sig: 'MEQCIBz3H1q2P9vKlmnopFakeReadyFixtureSignature',
        signedAt: SARAH.signedAt,
        sessionId: 'sess-fresh-cosign-1',
      },
    ],
    anchorRoot: null,
    anchorTxHash: null,
    anchorBlockNumber: null,
  },
  payloadHash: PAYLOAD_HASH_READY,
  payloadType: 'wire',
  payload: WIRE_PAYLOAD,
  signer: SARAH,
  expiresAt: NOW_SEC + 60 * 25,
  cosignChallenge: 'Y2hhbGxlbmdlLWZpeHR1cmUtcmVhZHk',
};

export const fixtureTampered: CosignContextResponse = {
  ok: true,
  messageId: 'msg-demo-tampered-001',
  envelope: {
    ...fixtureReady.envelope,
    // Server returns a different payloadHash than what's claimed in the JWS.
    payloadHash: PAYLOAD_HASH_TAMPERED,
    payload: { ...WIRE_PAYLOAD, recipientAccount: '••••9999' },
    payloadType: 'wire',
  },
  // Server reports payloadHash X, but the JWS claim (decoded by the client)
  // claims PAYLOAD_HASH_READY — so Step 4 of the checklist fails.
  payloadHash: PAYLOAD_HASH_TAMPERED,
  payloadType: 'wire',
  payload: { ...WIRE_PAYLOAD, recipientAccount: '••••9999' },
  signer: SARAH,
  expiresAt: NOW_SEC + 60 * 25,
  cosignChallenge: 'Y2hhbGxlbmdlLWZpeHR1cmUtdGFtcGVyZWQ',
};

export const fixtureExpired: CosignContextResponse = {
  ok: false,
  code: 'COSIGN_LINK_EXPIRED',
  detail: 'This cosign link expired at ' + new Date((NOW_SEC - 60) * 1000).toISOString() + '.',
};

export const fixtureAlreadySigned: CosignContextResponse = {
  ok: false,
  code: 'ALREADY_COSIGNED',
  detail: 'This wire has already been cosigned. No further action is required.',
};

export const fixtureInvalidLink: CosignContextResponse = {
  ok: false,
  code: 'COSIGN_LINK_INVALID',
  detail: 'The link signature did not validate against the company root key.',
};

export const FIXTURES: Record<string, CosignContextResponse> = {
  ready:           fixtureReady,
  tampered:        fixtureTampered,
  expired:         fixtureExpired,
  'already-signed': fixtureAlreadySigned,
  invalid:         fixtureInvalidLink,
};

export const fixtureFinalizeOk: FinalizeCosignResponse = {
  ok: true,
  messageId: 'msg-demo-cosign-001',
  anchorWillFollow: true,
};

export const fixtureRefreshOk: RefreshLinkResponse = {
  ok: true,
  freshLinkSent: true,
};

/**
 * Returns a synthetic JWS string for the named fixture so the client's
 * jws-decode + Step 4 hash compare flows can run end-to-end in fixture mode.
 *
 * Header: { "alg": "ES256", "typ": "JWT" }
 * Body  : { iss, sub, payloadHash, iat, exp }
 * Sig   : a non-cryptographic placeholder ("FIXTURE_SIG") that the client
 *         never validates. Server validates signatures in production.
 */
export function fixtureJws(fixtureKey: string): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  let claims: Record<string, unknown>;

  switch (fixtureKey) {
    case 'tampered':
      claims = {
        iss: SARAH.companyId,
        sub: 'msg-demo-tampered-001',
        // The client sees a different payloadHash than the server returns.
        payloadHash: PAYLOAD_HASH_READY,
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 60 * 25,
      };
      break;
    case 'expired':
      claims = {
        iss: SARAH.companyId,
        sub: 'msg-demo-expired-001',
        payloadHash: PAYLOAD_HASH_READY,
        iat: NOW_SEC - 60 * 60,
        exp: NOW_SEC - 60,
      };
      break;
    case 'already-signed':
      claims = {
        iss: SARAH.companyId,
        sub: 'msg-demo-already-001',
        payloadHash: PAYLOAD_HASH_READY,
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 60 * 25,
      };
      break;
    case 'ready':
    default:
      claims = {
        iss: SARAH.companyId,
        sub: 'msg-demo-cosign-001',
        payloadHash: PAYLOAD_HASH_READY,
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 60 * 25,
      };
  }

  const body = b64url(JSON.stringify(claims));
  return `${header}.${body}.FIXTURE_SIG`;
}

function b64url(s: string): string {
  // jsdom + browser: btoa works on ASCII; canonical bytes here are ASCII JSON.
  const b64 = typeof btoa !== 'undefined'
    ? btoa(s)
    : Buffer.from(s, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
