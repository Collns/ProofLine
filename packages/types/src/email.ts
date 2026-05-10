import { z } from 'zod';
import { WirePayload } from './wire.js';

export const EmailPayload = z.object({
  v: z.literal(1),
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  bcc: z.array(z.string().email()).default([]),
  subject: z.string(),
  body: z.string(),
  threadId: z.string().optional(),
  isWireInstruction: z.boolean().default(false),
  wirePayload: WirePayload.optional(),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().min(22),
  companyId: z.string(),
});
export type EmailPayload = z.infer<typeof EmailPayload>;
