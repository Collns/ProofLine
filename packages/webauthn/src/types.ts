import { z } from 'zod';

export const WebAuthnAssertion = z.object({
  credentialId: z.string(),
  clientDataJSON: z.string(),       // base64url
  authenticatorData: z.string(),    // base64url
  signature: z.string(),            // base64url DER
  userHandle: z.string().optional(), // base64url, may be absent
});
export type WebAuthnAssertion = z.infer<typeof WebAuthnAssertion>;

export const RegistrationResult = z.object({
  credentialId: z.string(),         // base64url
  publicKey: z.string(),            // base64-encoded COSE key (WebAuthn format)
  signCount: z.number().int().nonnegative(),
  aaguid: z.string().optional(),    // authenticator model
  transports: z.array(z.string()).optional(),
});
export type RegistrationResult = z.infer<typeof RegistrationResult>;

export const ChallengeRecord = z.object({
  challenge: z.string(),            // base64url
  userId: z.string(),
  purpose: z.enum(['registration', 'assertion']),
  rpId: z.string(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  consumed: z.boolean().default(false),
});
export type ChallengeRecord = z.infer<typeof ChallengeRecord>;

export interface ChallengeStore {
  put(record: ChallengeRecord): Promise<void>;
  get(challenge: string): Promise<ChallengeRecord | null>;
  /** Atomically mark as consumed; returns null if not found or already consumed. */
  consume(challenge: string): Promise<ChallengeRecord | null>;
  /** Delete expired records; returns the count removed. */
  cleanup(now: number): Promise<number>;
}
