/**
 * PFL-169 — providers are built from the explicit selection, with no
 * silent fallback to stubs.
 */

import { describe, it, expect, vi } from "vitest";
import type { AnchorProvider, Hex32 } from "@proofline/anchoring";

import { loadConfig } from "../../config/config.js";
import { makeEmailProvider, makeKmsProvider, makeOnboardingAnchorProvider, makeOnboardingDeps } from "../providers.js";
import { makeAnchorProviderFromConfig } from "../../anchoring/service-factory.js";
import { stubKmsProvider } from "../stubs.js";

describe("provider factories", () => {
  it("uses stubs only when selected", () => {
    const cfg = loadConfig({});
    expect(makeKmsProvider(cfg)).toBe(stubKmsProvider);
    expect(typeof makeEmailProvider(cfg).sendVerificationCode).toBe("function");
  });

  it("throws instead of falling back when a real provider lacks settings", () => {
    expect(() => makeEmailProvider({ providers: { email: "resend" } as never })).toThrow(/RESEND_API_KEY/);
    expect(() => makeKmsProvider({ providers: { kms: "gcp" } as never })).toThrow(/KMS_KEYRING/);
    expect(() => makeAnchorProviderFromConfig({ providers: { anchor: "base-sepolia" } })).toThrow(/BASE_SEPOLIA_RPC/);
  });
});

describe("makeOnboardingAnchorProvider", () => {
  it("hashes registry events into leaves and posts the provider's root", async () => {
    const buildTree = vi.fn((leaves: Hex32[]) => ({ root: ("0x" + "cd".repeat(32)) as Hex32, leaves, proofFor: () => null }));
    const postAnchor = vi.fn(async (root: Hex32) => ({ root, txHash: ("0x" + "ef".repeat(32)) as Hex32, blockNumber: 42n, timestamp: 1n }));
    const anchor = { buildTree, postAnchor } as unknown as AnchorProvider;

    const adapter = makeOnboardingAnchorProvider(anchor);
    const { root } = adapter.buildTree([
      { type: "COMPANY_VERIFIED", companyId: "c1", payload: {}, timestamp: 1 },
      { type: "CREDENTIAL_ISSUED", companyId: "c1", payload: {}, timestamp: 1 },
    ]);
    expect(root).toBe("0x" + "cd".repeat(32));
    const leaves = buildTree.mock.calls[0]![0];
    expect(leaves).toHaveLength(2);
    for (const l of leaves) expect(l).toMatch(/^0x[0-9a-f]{64}$/);
    expect(leaves[0]).not.toBe(leaves[1]);

    expect(await adapter.postAnchor(root)).toEqual({ txHash: "0x" + "ef".repeat(32), blockNumber: 42 });
  });
});

describe("makeOnboardingDeps", () => {
  it("sends verification codes through the selected email provider (no logging)", async () => {
    const sendVerificationCode = vi.fn(async () => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeOnboardingDeps(loadConfig({}), {
      email:  { sendVerificationCode } as never,
      anchor: makeAnchorProviderFromConfig({ providers: { anchor: "stub" } }),
    });
    await deps.sendVerificationCode("owner@acme.test", "123456");
    expect(sendVerificationCode).toHaveBeenCalledWith("owner@acme.test", "123456");
    expect(log.mock.calls.flat().join(" ")).not.toContain("123456");
    log.mockRestore();
  });
});
