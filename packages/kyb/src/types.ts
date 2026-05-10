import { z } from 'zod';

export const KYBFlag = z.object({
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  detail: z.string().optional(),
});
export type KYBFlag = z.infer<typeof KYBFlag>;

export const BusinessLookupInput = z.object({
  legalName: z.string(),
  ein: z.string(),
  state: z.string(),
  country: z.literal('US'),
});
export type BusinessLookupInput = z.infer<typeof BusinessLookupInput>;

export const BusinessVerification = z.object({
  ok: z.boolean(),
  vendorRef: z.string(),
  flags: z.array(KYBFlag),
  officers: z.array(z.object({
    name: z.string(),
    role: z.string(),
  })),
  raw: z.unknown(),
});
export type BusinessVerification = z.infer<typeof BusinessVerification>;

export const OfficerKYCInput = z.object({
  email: z.string().email(),
  expectedName: z.string().optional(),
});
export type OfficerKYCInput = z.infer<typeof OfficerKYCInput>;

export const OfficerVerification = z.object({
  ok: z.boolean(),
  vendorRef: z.string(),
  documentVerified: z.boolean(),
  livenessConfirmed: z.boolean(),
  matchedExpected: z.boolean(),
  raw: z.unknown(),
});
export type OfficerVerification = z.infer<typeof OfficerVerification>;

export interface KYBProvider {
  verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification>;
  verifyOfficer(input: OfficerKYCInput): Promise<OfficerVerification>;
}
