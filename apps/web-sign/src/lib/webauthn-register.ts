// WebAuthn registration helper (PFL-069).
//
// Wraps navigator.credentials.create() with the parameter set the
// ProofLine sign popup uses on subsequent navigator.credentials.get()
// calls. RP ID is "proofline-sign.web.app" — see
// apps/extension-chrome/src/shared/config.ts and SignStart.tsx.
//
// The challenge is generated client-side because the hackathon server
// does not verify attestation. When the server starts verifying
// attestation, swap the random challenge for one issued by
// /v1/extension/registration-challenge.

const RP_ID   = 'proofline-sign.web.app';
const RP_NAME = 'ProofLine';

export interface RegistrationResult {
  credentialId:      string; // base64url(rawId)
  publicKey:         string; // base64url(SPKI) — getPublicKey()
  attestationObject: string; // base64url(attestationObject)
  clientDataJSON:    string; // base64url(clientDataJSON)
}

export interface RegisterInput {
  userId:       string;
  email:        string;
  /** Optional pre-issued challenge; otherwise a random 32-byte one is generated. */
  challengeB64?: string;
}

export async function registerPlatformAuthenticator(
  input: RegisterInput,
): Promise<RegistrationResult> {
  if (typeof navigator === 'undefined' || !navigator.credentials?.create) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const challenge = input.challengeB64
    ? b64urlToBytes(input.challengeB64)
    : randomBytes(32);

  const userIdBytes = stringToBytes(input.userId);

  const publicKey: PublicKeyCredentialCreationOptions = {
    rp:   { id: RP_ID, name: RP_NAME },
    user: {
      id:          userIdBytes,
      name:        input.email || input.userId,
      displayName: input.email || input.userId,
    },
    challenge,
    // ES256 first; RS256 fallback covers older Windows Hello stacks.
    pubKeyCredParams: [
      { type: 'public-key', alg: -7   },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification:        'required',
      residentKey:             'preferred',
    },
    attestation: 'none',
    timeout:     90_000,
  };

  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error('navigator.credentials.create returned null');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  // getPublicKey() returns SubjectPublicKeyInfo (SPKI) bytes when the
  // authenticator supports it. Older platforms may not — fall back to
  // an empty string so the server still records the credential.
  let publicKeyB64 = '';
  if (typeof response.getPublicKey === 'function') {
    const spki = response.getPublicKey();
    if (spki) publicKeyB64 = bytesToB64url(new Uint8Array(spki));
  }

  return {
    credentialId:      bytesToB64url(new Uint8Array(credential.rawId)),
    publicKey:         publicKeyB64,
    attestationObject: bytesToB64url(new Uint8Array(response.attestationObject)),
    clientDataJSON:    bytesToB64url(new Uint8Array(response.clientDataJSON)),
  };
}

// ─── base64url helpers ───────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
