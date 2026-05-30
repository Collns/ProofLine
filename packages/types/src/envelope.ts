import { z } from 'zod';
import { EmailPayload } from './email.js';
import { BilateralPayload } from './bilateral.js';
import { WirePayload } from './wire.js';

export const SignerInfo = z.object({
  userId: z.string(),
  credentialId: z.string(),
  role: z.string(),
  sig: z.string(),                 // base64url DER ECDSA
  signedAt: z.number().int(),
  sessionId: z.string().nullable().default(null),
  // PFL-125: WebAuthn assertion material captured at sign time. When BOTH
  // are present, verify-time signature checking reconstructs the bytes
  // the authenticator actually signed (authData || sha256(clientDataJSON))
  // and verifies `sig` against that. When absent (legacy envelopes or
  // server-key signatures), the verifier falls back to checking `sig`
  // against `canonicalize(payload)` directly.
  authenticatorData: z.string().optional(),  // base64url
  clientDataJSON:    z.string().optional(),  // base64url
});
export type SignerInfo = z.infer<typeof SignerInfo>;

export const SignedEnvelope = z.object({
  v: z.literal(1),
  payloadType: z.enum(['wire', 'email', 'bilateral']),
  payload: z.union([WirePayload, EmailPayload, BilateralPayload]),
  payloadHash: z.string(),         // sha256 of canonical bytes
  signers: z.array(SignerInfo).min(1),
  anchorRoot: z.string().nullable().default(null),
  anchorTxHash: z.string().nullable().default(null),
  anchorBlockNumber: z.number().int().nullable().default(null),
});
export type SignedEnvelope = z.infer<typeof SignedEnvelope>;
