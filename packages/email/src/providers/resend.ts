import { Resend } from 'resend';
import type {
  EmailProvider,
  SendInput,
  WireSummary,
  BilateralSummary,
} from '../types.js';

export interface ResendOptions {
  apiKey: string;
  fromDomain: string;
  fromName?: string;
}

function formatUSD(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function tagsToArray(
  tags?: Record<string, string>,
): { name: string; value: string }[] | undefined {
  if (!tags) return undefined;
  return Object.entries(tags).map(([name, value]) => ({ name, value }));
}

export function makeResendProvider(opts: ResendOptions): EmailProvider {
  const resend = new Resend(opts.apiKey);
  const fromName = opts.fromName ?? 'ProofLine';
  const from = `${fromName} <noreply@${opts.fromDomain}>`;

  async function rawSend(input: SendInput): Promise<{ id: string }> {
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      tags: tagsToArray(input.tags),
    });
    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
    if (!data) {
      throw new Error('Resend returned no data');
    }
    return { id: data.id };
  }

  return {
    send: rawSend,

    async sendVerificationCode(to: string, code: string) {
      await rawSend({
        to: [to],
        subject: 'Your ProofLine verification code',
        html: `<p>Your verification code: <strong style="font-size:24px;font-family:monospace">${code}</strong></p><p>This code expires in 10 minutes.</p>`,
        text: `Your ProofLine verification code: ${code}\n\nThis code expires in 10 minutes.`,
        tags: { type: 'verification' },
      });
    },

    async sendCosignRequest(to: string[], wire: WireSummary, signLink: string) {
      const amount = formatUSD(wire.amount);
      await rawSend({
        to,
        subject: `Co-sign request: ${amount}`,
        html: `
          <h2>Co-sign needed</h2>
          <p>A wire transfer of <strong>${amount}</strong> requires your approval.</p>
          <ul>
            <li>Account ending: ${wire.recipientAccountLast4}</li>
            <li>Routing: ${wire.routingNumber}</li>
            ${wire.memo ? `<li>Memo: ${wire.memo}</li>` : ''}
          </ul>
          <p><a href="${signLink}" style="background:#0D6EFD;color:white;padding:12px 24px;text-decoration:none;border-radius:4px">Review and sign</a></p>
        `,
        text: `Co-sign needed for ${amount} (account ending ${wire.recipientAccountLast4}). Review: ${signLink}`,
        tags: { type: 'cosign' },
      });
    },

    async sendInvitation(to: string, inviterCompany: string, inviteToken: string) {
      await rawSend({
        to: [to],
        subject: `${inviterCompany} invites you to ProofLine`,
        html: `
          <h2>${inviterCompany} has invited you to verify with ProofLine</h2>
          <p>ProofLine cryptographically signs business communications to prevent wire fraud.</p>
          <p><a href="https://app.proofline.web.app/invite/${inviteToken}" style="background:#0D6EFD;color:white;padding:12px 24px;text-decoration:none;border-radius:4px">Get verified</a></p>
        `,
        text: `${inviterCompany} has invited you to verify with ProofLine. Get started: https://app.proofline.web.app/invite/${inviteToken}`,
        tags: { type: 'invitation' },
      });
    },

    async sendBilateralRequest(to: string, doc: BilateralSummary, signLink: string) {
      await rawSend({
        to: [to],
        subject: `Bilateral document for review: ${doc.documentType}`,
        html: `
          <h2>${doc.drafterName} at ${doc.drafterCompany} has sent you a ${doc.documentType}</h2>
          <p>Review and counter-sign to confirm the agreement.</p>
          <p><a href="${signLink}" style="background:#0D6EFD;color:white;padding:12px 24px;text-decoration:none;border-radius:4px">Review document</a></p>
        `,
        text: `${doc.drafterName} at ${doc.drafterCompany} has sent you a ${doc.documentType}. Review: ${signLink}`,
        tags: { type: 'bilateral' },
      });
    },
  };
}
