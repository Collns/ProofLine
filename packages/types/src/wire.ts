import { z } from 'zod';

export const WirePayload = z.object({
  v: z.literal(1),
  amount: z.number().int().positive(),
  currency: z.literal('USD'),
  recipientAccount: z.string().regex(/^[0-9X•]{4,}$/),
  recipientRouting: z.string().regex(/^\d{9}$/),
  memo: z.string().max(500).optional(),
  reference: z.string().optional(),
});
export type WirePayload = z.infer<typeof WirePayload>;
