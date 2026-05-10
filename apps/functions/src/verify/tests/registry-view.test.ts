import { describe, it, expect, vi } from "vitest";
import { makeFirestoreRegistryView } from "../registry-view.js";
import { makeStubFirestore, StubStore } from "./firestore-stub.js";
import type { Hex32 } from "@proofline/verification";

const ROOT: Hex32 = "0xdeadbeef";

function buildView(opts?: {
  readAnchor?: (root: Hex32) => Promise<{ blockNumber: bigint; timestamp: bigint } | null>;
}) {
  const store = new StubStore();
  const firestore = makeStubFirestore(store);
  const readAnchor =
    opts?.readAnchor ??
    vi.fn(async () => ({ blockNumber: 42n, timestamp: 1_700_000_000n }));
  const view = makeFirestoreRegistryView({
    firestore,
    chainReader: { readAnchor },
  });
  return { view, store, readAnchor };
}

describe("FirestoreRegistryView — getCompany", () => {
  it("returns a shaped Company when the doc exists", async () => {
    const { view, store } = buildView();
    store.set("companies", "company-a", {
      companyId: "company-a",
      domain: "company-a.com",
      legalName: "Company A Inc.",
      rootPublicKey: "spki-base64",
      status: "verified",
      verifiedAt: 1_700_000_000,
    });

    const c = await view.getCompany("company-a");
    expect(c).not.toBeNull();
    expect(c?.companyId).toBe("company-a");
    expect(c?.domain).toBe("company-a.com");
    expect(c?.status).toBe("verified");
  });

  it("returns null when the company doc is missing", async () => {
    const { view } = buildView();
    expect(await view.getCompany("nope")).toBeNull();
  });
});

describe("FirestoreRegistryView — getUserCredential", () => {
  it("filters by credentialId via collectionGroup across users", async () => {
    const { view, store } = buildView();
    store.set("users/user-a/role_credentials", "cred-a", {
      v: 1,
      credentialId: "cred-a",
      publicKey: "pk-a",
      userId: "user-a",
      companyId: "company-a",
      role: "employee",
      perEmailLimitUsd: 10000,
      dailyLimitUsd: null,
      issuedAt: 1_700_000_000,
      revokedAt: null,
      issuerSig: "issuer-sig-a",
    });
    store.set("users/user-b/role_credentials", "cred-b", {
      v: 1,
      credentialId: "cred-b",
      publicKey: "pk-b",
      userId: "user-b",
      companyId: "company-b",
      role: "employee",
      perEmailLimitUsd: 5000,
      dailyLimitUsd: null,
      issuedAt: 1_700_000_001,
      revokedAt: null,
      issuerSig: "issuer-sig-b",
    });

    const found = await view.getUserCredential("cred-b");
    expect(found?.credentialId).toBe("cred-b");
    expect(found?.userId).toBe("user-b");

    expect(await view.getUserCredential("cred-zzz")).toBeNull();
  });
});

describe("FirestoreRegistryView — isRevoked", () => {
  it("returns true when revocations/{credId} exists", async () => {
    const { view, store } = buildView();
    expect(await view.isRevoked("cred-a")).toBe(false);
    store.set("revocations", "cred-a", { revokedAt: 1_700_000_000 });
    expect(await view.isRevoked("cred-a")).toBe(true);
  });
});

describe("FirestoreRegistryView — read-only nonce semantics", () => {
  it("isNonceUsed reads but the view exposes no recordNonce method", async () => {
    const { view, store } = buildView();
    expect(await view.isNonceUsed("nonce-x")).toBe(false);
    store.set("nonces", "nonce-x", { usedAt: 1_700_000_000 });
    expect(await view.isNonceUsed("nonce-x")).toBe(true);

    // recordNonce is deliberately absent — verify path must never write.
    expect((view as unknown as Record<string, unknown>).recordNonce).toBeUndefined();
  });
});

describe("FirestoreRegistryView — getAnchorForRoot delegates to chain reader", () => {
  it("returns chain-confirmed anchor when readAnchor finds the root", async () => {
    const readAnchor = vi.fn(async () => ({
      blockNumber: 99n,
      timestamp: 1_700_000_500n,
    }));
    const { view } = buildView({ readAnchor });

    const a = await view.getAnchorForRoot(ROOT);
    expect(readAnchor).toHaveBeenCalledWith(ROOT);
    expect(a?.root).toBe(ROOT);
    expect(a?.blockNumber).toBe(99n);
    expect(a?.timestamp).toBe(1_700_000_500n);
  });

  it("returns null when the chain reader has no record (chain wins over Firestore)", async () => {
    const readAnchor = vi.fn(async () => null);
    const { view } = buildView({ readAnchor });

    expect(await view.getAnchorForRoot(ROOT)).toBeNull();
  });
});
