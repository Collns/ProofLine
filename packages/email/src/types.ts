import { z } from 'zod';

export const SendInput = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  tags: z.record(z.string()).optional(),
  replyTo: z.string().email().optional(),
});
export type SendInput = z.infer<typeof SendInput>;

export interface WireSummary {
  amount: number;
  recipientAccountLast4: string;
  routingNumber: string;
  memo?: string;
}

export interface BilateralSummary {
  documentId: string;
  documentType: string;
  drafterName: string;
  drafterCompany: string;
}

export interface EmailProvider {
  send(input: SendInput): Promise<{ id: string }>;
  sendVerificationCode(to: string, code: string): Promise<void>;
  sendCosignRequest(
    to: string[],
    wire: WireSummary,
    signLink: string,
  ): Promise<void>;
  sendInvitation(
    to: string,
    inviterCompany: string,
    inviteToken: string,
  ): Promise<void>;
  sendBilateralRequest(
    to: string,
    doc: BilateralSummary,
    signLink: string,
  ): Promise<void>;
}
