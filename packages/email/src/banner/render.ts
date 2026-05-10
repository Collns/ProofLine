import { z } from 'zod';
import { escapeHtml, escapeAttr } from './escape.js';
import { STATE_CONFIG, type BannerState } from './states.js';

export const BannerInput = z.object({
  state: z.enum(['verified', 'bilateral', 'suspected_spoof']),
  signerName: z.string(),
  companyName: z.string(),
  companyDomain: z.string(),
  envelopeId: z.string(),
  verifyBaseUrl: z.string().url(),
});
export type BannerInput = z.infer<typeof BannerInput>;

export function renderEnvelopeBanner(rawInput: BannerInput): string {
  const input = BannerInput.parse(rawInput);
  const state: BannerState = input.state;
  const cfg = STATE_CONFIG[state];

  const signer = escapeHtml(input.signerName);
  const company = escapeHtml(input.companyName);
  const domain = escapeHtml(input.companyDomain);

  const body = cfg.bodyTemplate
    .replace('{signerName}', signer)
    .replace('{companyName}', company);

  const verifyHref = escapeAttr(
    `${input.verifyBaseUrl.replace(/\/$/, '')}/${input.envelopeId}`,
  );

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  return [
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 16px 0;font-family:${fontStack};">`,
    `  <tr>`,
    `    <td style="border-left:4px solid ${cfg.borderColor};background:${cfg.bgColor};padding:12px 16px;">`,
    `      <div style="font-size:14px;font-weight:600;color:${cfg.textColor};">`,
    `        <span style="display:inline-block;margin-right:6px;">${cfg.iconChar}</span>`,
    `        ${escapeHtml(cfg.headline)}`,
    `      </div>`,
    `      <div style="font-size:13px;color:${cfg.textColor};margin-top:4px;line-height:1.4;">`,
    `        ${body}`,
    `      </div>`,
    `      <div style="font-size:12px;margin-top:8px;">`,
    `        <a href="${verifyHref}" style="color:${cfg.borderColor};text-decoration:underline;">Verify the signature →</a>`,
    `        <span style="color:#6B7280;margin-left:8px;">${domain}</span>`,
    `      </div>`,
    `    </td>`,
    `  </tr>`,
    `</table>`,
  ].join('\n');
}
