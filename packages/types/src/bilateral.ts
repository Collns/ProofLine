import { z } from 'zod';

export const BilateralPayload = z.object({
  v: z.literal(1),
  docId: z.string(),
  docType: z.enum(['banking_change', 'vendor_onboarding', 'payment_terms']),
  drafterCompanyId: z.string(),
  counterpartyCompanyId: z.string(),
  content: z.record(z.unknown()),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().min(22),
});
export type BilateralPayload = z.infer<typeof BilateralPayload>;
