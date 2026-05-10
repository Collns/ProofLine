import { describe, it, expect } from "vitest";
import type {
  VerificationResult,
  VerifiedSignerInfo,
  Anchor,
  Hex32,
} from "@proofline/verification";
import type { EmailPayload, BilateralPayload } from "@proofline/types";

import { shapeResponse } from "../shape-response.js";

const ROOT = "0xdeadbeef" as Hex32;

const sarah: VerifiedSignerInfo = {
  userId: "user-sarah",
  credentialId: "cred-sarah",
  role: "manager",
  sig: "sig-sarah",
  signedAt: 1_700_000_000,
  sessionId: "sess-sarah",
  companyId: "acme-title",
  companyDomain: "acme-title.com",
  companyLegalName: "Acme Title LLC",
  userDisplayName: "Sarah Chen",
};

const james: VerifiedSignerInfo = {
  userId: "user-james",
  credentialId: "cred-james",
  role: "owner",
  sig: "sig-james",
  signedAt: 1_700_000_300,
  sessionId: "sess-james",
  companyId: "first-national",
  companyDomain: "firstnational.com",
  companyLegalName: "First National Bank",
  userDisplayName: "James Whitfield",
};

const anchor: Anchor = {
  root: ROOT,
  blockNumber: 12_847_392n,
  timestamp: 1_715_040_000n,
};

const emailPayload: EmailPayload = {
  v: 1,
  from: "sarah@acme-title.com",
  to: ["james@firstnational.com"],
  cc: [],
  bcc: [],
  subject: "Closing documents",
  body: "Hi James,\n\nthe closing package is ready.",
  isWireInstruction: false,
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_086_400,
  nonce: "nonce-aaaaaaaaaaaaaaaaaaaaaa",
  companyId: "acme-title",
};

const bilateralPayload: BilateralPayload = {
  v: 1,
  docId: "doc-banking-change",
  docType: "banking_change",
  drafterCompanyId: "acme-title",
  counterpartyCompanyId: "first-national",
  content: { description: "switch wire account" },
  issuedAt: 1_700_000_000,
  expiresAt: 1_701_000_000,
  nonce: "nonce-bbbbbbbbbbbbbbbbbbbbbb",
};

describe("shapeResponse — verified", () => {
  it("preserves the hydrated signer info fields the verify page reads", () => {
    const input: VerificationResult = {
      ok: true,
      state: "verified",
      signers: [sarah],
      payload: emailPayload,
      anchor,
    };
    const out = shapeResponse(input);

    if (!(out.ok && out.state === "verified")) {
      throw new Error(`expected verified, got ${JSON.stringify(out)}`);
    }
    expect(out.signers).toHaveLength(1);
    expect(out.signers[0].companyDomain).toBe("acme-title.com");
    expect(out.signers[0].companyLegalName).toBe("Acme Title LLC");
    expect(out.signers[0].userDisplayName).toBe("Sarah Chen");
  });

  it("converts anchor.blockNumber from bigint to string", () => {
    const out = shapeResponse({
      ok: true,
      state: "verified",
      signers: [sarah],
      payload: emailPayload,
      anchor,
    });
    if (!(out.ok && out.state === "verified")) throw new Error("wrong state");
    expect(out.anchor.blockNumber).toBe("12847392");
    expect(typeof out.anchor.blockNumber).toBe("string");
  });

  it("converts anchor.timestamp from bigint to string", () => {
    const out = shapeResponse({
      ok: true,
      state: "verified",
      signers: [sarah],
      payload: emailPayload,
      anchor,
    });
    if (!(out.ok && out.state === "verified")) throw new Error("wrong state");
    expect(out.anchor.timestamp).toBe("1715040000");
    expect(typeof out.anchor.timestamp).toBe("string");
  });

  it("the response body survives JSON.stringify (no raw bigints leak)", () => {
    const out = shapeResponse({
      ok: true,
      state: "verified",
      signers: [sarah],
      payload: emailPayload,
      anchor,
    });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe("shapeResponse — bilateral", () => {
  it("preserves both counter-signers with hydrated company fields", () => {
    const out = shapeResponse({
      ok: true,
      state: "bilateral",
      signers: [sarah, james],
      payload: bilateralPayload,
      anchor,
    });
    if (!(out.ok && out.state === "bilateral")) throw new Error("wrong state");

    expect(out.signers).toHaveLength(2);
    expect(out.signers[0].companyId).toBe("acme-title");
    expect(out.signers[1].companyId).toBe("first-national");
    expect(out.signers[1].companyLegalName).toBe("First National Bank");
  });
});

describe("shapeResponse — suspected_spoof and rejected", () => {
  it("preserves claimedCompany and detail on suspected_spoof", () => {
    const out = shapeResponse({
      ok: true,
      state: "suspected_spoof",
      claimedCompany: {
        companyId: "acme-title",
        domain: "acme-title.com",
        legalName: "Acme Title LLC",
      },
      detail: "no valid signature for verified domain",
    });
    if (!(out.ok && out.state === "suspected_spoof"))
      throw new Error("wrong state");

    expect(out.claimedCompany.domain).toBe("acme-title.com");
    expect(out.detail).toContain("no valid signature");
  });

  it("preserves code + detail on rejected", () => {
    const out = shapeResponse({
      ok: false,
      state: "rejected",
      code: "PAYLOAD_HASH_MISMATCH",
      detail: "expected X, got Y",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("wrong ok");
    expect(out.state).toBe("rejected");
    expect(out.code).toBe("PAYLOAD_HASH_MISMATCH");
    expect(out.detail).toBe("expected X, got Y");
  });
});
