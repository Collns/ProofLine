import { z } from 'zod';

export const SessionToken = z.object({
  v: z.literal(1),
  sessionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  recipientScope: z.string(),       // sorted-set hash
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionToken = z.infer<typeof SessionToken>;
