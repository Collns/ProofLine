import { z } from 'zod';

export const Role = z.enum(['owner', 'manager', 'employee']);
export type Role = z.infer<typeof Role>;

export const RoleCredential = z.object({
  v: z.literal(1),
  credentialId: z.string(),       // WebAuthn credential ID
  publicKey: z.string(),           // SPKI base64
  userId: z.string(),
  companyId: z.string(),
  role: Role,
  perEmailLimitUsd: z.number().int().nonnegative().nullable(),
  dailyLimitUsd: z.number().int().nonnegative().nullable(),
  issuedAt: z.number().int(),
  revokedAt: z.number().int().nullable().default(null),
  issuerSig: z.string(),           // signature by company root
});
export type RoleCredential = z.infer<typeof RoleCredential>;
