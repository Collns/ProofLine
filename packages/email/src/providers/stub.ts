import * as crypto from 'node:crypto';
import type {
  EmailProvider,
  SendInput,
  WireSummary,
  BilateralSummary,
} from '../types.js';

export interface CapturedEmail {
  id: string;
  type: 'send' | 'verification_code' | 'cosign' | 'invitation' | 'bilateral';
  to: string[];
  subject: string;
  html: string;
  text: string;
  tags?: Record<string, string>;
  replyTo?: string;
  meta?: Record<string, unknown>;
  capturedAt: number;
}

export interface StubEmailProvider extends EmailProvider {
  getCaptured(): readonly CapturedEmail[];
  clearCaptured(): void;
  getLast(): CapturedEmail | null;
}

export interface StubEmailOptions {
  now?: () => number;
}

function genId(): string {
  return `stub_email_${crypto.randomBytes(8).toString('hex')}`;
}

export function makeStubEmailProvider(opts?: StubEmailOptions): StubEmailProvider {
  const captured: CapturedEmail[] = [];
  const now = opts?.now ?? (() => Date.now());

  return {
    async send(input: SendInput) {
      const id = genId();
      captured.push({
        id,
        type: 'send',
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        tags: input.tags,
        replyTo: input.replyTo,
        capturedAt: now(),
      });
      return { id };
    },

    async sendVerificationCode(to: string, code: string) {
      const id = genId();
      captured.push({
        id,
        type: 'verification_code',
        to: [to],
        subject: 'Your ProofLine verification code',
        html: `<p>Your code: <strong>${code}</strong></p>`,
        text: `Your code: ${code}`,
        meta: { code },
        capturedAt: now(),
      });
    },

    async sendCosignRequest(to: string[], wire: WireSummary, signLink: string) {
      const id = genId();
      const subject = `Co-sign request: $${(wire.amount / 100).toFixed(2)}`;
      captured.push({
        id,
        type: 'cosign',
        to,
        subject,
        html: `<p>Co-sign needed: <a href="${signLink}">Sign now</a></p>`,
        text: `Co-sign needed: ${signLink}`,
        meta: { wire, signLink },
        capturedAt: now(),
      });
    },

    async sendInvitation(to: string, inviterCompany: string, inviteToken: string) {
      const id = genId();
      captured.push({
        id,
        type: 'invitation',
        to: [to],
        subject: `${inviterCompany} invites you to ProofLine`,
        html: `<p>${inviterCompany} has invited you. Token: ${inviteToken}</p>`,
        text: `${inviterCompany} has invited you. Token: ${inviteToken}`,
        meta: { inviterCompany, inviteToken },
        capturedAt: now(),
      });
    },

    async sendBilateralRequest(to: string, doc: BilateralSummary, signLink: string) {
      const id = genId();
      captured.push({
        id,
        type: 'bilateral',
        to: [to],
        subject: `Bilateral document: ${doc.documentType}`,
        html: `<p>Document from ${doc.drafterCompany}: <a href="${signLink}">Review</a></p>`,
        text: `Document from ${doc.drafterCompany}: ${signLink}`,
        meta: { doc, signLink },
        capturedAt: now(),
      });
    },

    getCaptured() {
      return captured;
    },

    clearCaptured() {
      captured.length = 0;
    },

    getLast() {
      return captured[captured.length - 1] ?? null;
    },
  };
}
