/**
 * @file banner.ts
 * @module @proofline/email/banner
 *
 * Sender-side inline HTML verification banner (F-VER-08).
 *
 * Rules:
 *  - Table-based, fully inline-styled — renders in Gmail / Outlook with zero
 *    recipient install.
 *  - No external resources (no images, no web fonts, no remote CSS).
 *  - Color tokens per PRD §8.2.
 *  - Three states: verified | cosigned | pending_cosign
 *  - Must be injected at the TOP of the Gmail compose body before send.
 *
 * The string returned by renderBanner() is the value placed in
 * SignFinalizeResponse.banner and stored on the envelope record.
 */

// ─── Local types ──────────────────────────────────────────────────────────────
// The shared SignedEnvelope from @proofline/types predates the email signing
// fields. Banner uses its own minimal interface to avoid coupling.

interface EmailSignedEnvelope {
  envelopeId: string;
  status: "SIGNED" | "PENDING_COSIGN" | "COSIGNED";
  signatures: Array<{
    signerId: string;
    signedAt: number;
  }>;
  payload: {
    isWireInstruction: boolean;
  };
}

export interface SignerDisplayRecord {
  userId: string;
  name: string;
  role: string;
  companyName: string;
  domain: string;
  signedAt: number;
}

// ─── Design tokens (PRD §8.2) ─────────────────────────────────────────────────

const COLORS = {
  navy900: "#0B1F3A",
  green600: "#0F9D58",
  emerald700: "#047857",
  amber700: "#B45309",
  gray200: "#E5E7EB",
  gray500: "#6B7280",
  gray50: "#FAFAFA",
  white: "#FFFFFF",
} as const;

// Firebase Hosting site IDs are FULL subdomains (no nesting under a parent).
// The deployed verify subapp has site ID `proofline-verify`, which resolves
// to the URL below. PFL-097 fixed a prior value that used a non-existent
// nested-style hostname and returned NET::ERR_CERT_COMMON_NAME_INVALID at
// click time. Confirmed via `firebase hosting:sites:list --project proofline-cdabb`.
const VERIFY_BASE_URL = "https://proofline-verify.web.app";

// ─── Internal types ───────────────────────────────────────────────────────────

type BannerState = "verified" | "cosigned" | "pending_cosign";

interface BannerContext {
  envelopeId: string;
  state: BannerState;
  signers: Array<{
    name: string;
    role: string;
    companyName: string;
    domain: string;
    signedAt: number;
  }>;
  isWireInstruction: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function stateLabel(state: BannerState): string {
  switch (state) {
    case "verified":       return "✓ Signed by ProofLine";
    case "cosigned":       return "✓✓ Co-signed by ProofLine";
    case "pending_cosign": return "⏳ Awaiting co-signer approval";
  }
}

function stateBorderColor(state: BannerState): string {
  switch (state) {
    case "verified":       return COLORS.green600;
    case "cosigned":       return COLORS.emerald700;
    case "pending_cosign": return COLORS.amber700;
  }
}

function stateLabelColor(state: BannerState): string {
  switch (state) {
    case "verified":       return COLORS.green600;
    case "cosigned":       return COLORS.emerald700;
    case "pending_cosign": return COLORS.amber700;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function signerRow(signer: BannerContext["signers"][number]): string {
  return `
    <tr>
      <td style="padding:4px 0;font-size:13px;color:${COLORS.navy900};
                 font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <strong>${escapeHtml(signer.name)}</strong>
        <span style="color:${COLORS.gray500};margin-left:6px;">
          ${escapeHtml(signer.role)} · ${escapeHtml(signer.companyName)}
          (${escapeHtml(signer.domain)})
        </span>
      </td>
      <td style="padding:4px 0 4px 16px;font-size:12px;color:${COLORS.gray500};
                 white-space:nowrap;
                 font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        ${escapeHtml(formatDate(signer.signedAt))}
      </td>
    </tr>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function renderBanner(ctx: BannerContext): string {
  const borderColor = stateBorderColor(ctx.state);
  const labelColor = stateLabelColor(ctx.state);
  const verifyUrl = `${VERIFY_BASE_URL}/${encodeURIComponent(ctx.envelopeId)}`;
  const signerRows = ctx.signers.map(signerRow).join("");
  const wireNote = ctx.isWireInstruction
    ? `<tr><td colspan="2" style="padding-top:6px;font-size:12px;color:${COLORS.amber700};
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
         ⚠ Wire instruction — verify account details before processing.
       </td></tr>`
    : "";

  return `<!-- ProofLine-Banner-v1 -->
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
       style="border-collapse:collapse;margin:0 0 16px 0;
              border-left:4px solid ${borderColor};
              background-color:${COLORS.gray50};
              border-radius:0 4px 4px 0;">
  <tbody>
    <tr>
      <td style="padding:12px 16px;">

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tbody>
            <tr>
              <td style="font-size:14px;font-weight:600;color:${labelColor};
                         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                ${stateLabel(ctx.state)}
              </td>
              <td align="right" style="font-size:13px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                <a href="${escapeHtml(verifyUrl)}"
                   style="color:${COLORS.navy900};text-decoration:underline;">
                  Verify signature →
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tbody>
            <tr>
              <td style="border-top:1px solid ${COLORS.gray200};padding-top:8px;margin-top:8px;">
              </td>
            </tr>
          </tbody>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tbody>
            ${signerRows}
            ${wireNote}
          </tbody>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="margin-top:8px;border-top:1px solid ${COLORS.gray200};">
          <tbody>
            <tr>
              <td style="padding-top:6px;font-size:11px;color:${COLORS.gray500};
                         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                Anchored on Base · Envelope&nbsp;
                <code style="font-family:monospace;font-size:10px;">
                  ${escapeHtml(ctx.envelopeId.slice(0, 8))}…
                </code>
                &nbsp;·&nbsp;
                <a href="https://proofline.app"
                   style="color:${COLORS.gray500};text-decoration:none;">
                  ProofLine
                </a>
              </td>
            </tr>
          </tbody>
        </table>

      </td>
    </tr>
  </tbody>
</table>
<!-- /ProofLine-Banner-v1 -->`;
}

// ─── Convenience factory ──────────────────────────────────────────────────────

export function renderBannerFromEnvelope(
  envelope: EmailSignedEnvelope,
  signerDisplayRecords: SignerDisplayRecord[]
): string {
  const state: BannerState =
    envelope.status === "COSIGNED"
      ? "cosigned"
      : envelope.status === "PENDING_COSIGN"
      ? "pending_cosign"
      : "verified";

  const signers = envelope.signatures.map((sig) => {
    const display = signerDisplayRecords.find((r) => r.userId === sig.signerId);
    return {
      name: display?.name ?? sig.signerId,
      role: display?.role ?? "Unknown",
      companyName: display?.companyName ?? "",
      domain: display?.domain ?? "",
      signedAt: sig.signedAt,
    };
  });

  return renderBanner({
    envelopeId: envelope.envelopeId,
    state,
    signers,
    isWireInstruction: envelope.payload.isWireInstruction,
  });
}