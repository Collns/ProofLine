import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "./helpers/chrome-mock.js";

let chromeMock: ChromeMock;
beforeEach(() => {
  chromeMock = installChromeMock();
});
afterEach(() => {
  chromeMock.uninstall();
});

async function importAuthToken() {
  vi.resetModules();
  return await import("../src/background/auth-token.js");
}
async function importStore() {
  vi.resetModules();
  return await import("../src/background/session-store.js");
}

const FAR_FUTURE_SEC = Math.floor(Date.now() / 1000) + 24 * 3600;

describe("auth-token", () => {
  it("returns null from getAuthToken when nothing is stored", async () => {
    const a = await importAuthToken();
    expect(await a.getAuthToken()).toBeNull();
    expect(await a.isAuthTokenValid()).toBe(false);
  });

  it("returns the cached token when exp is comfortably in the future", async () => {
    const store = await importStore();
    await store.setAuthToken({
      token:        "cached-tok",
      userId:       "u1",
      companyId:    "c1",
      email:        "u1@example.com",
      extInstallId: "ext_1",
      iat:          Math.floor(Date.now() / 1000),
      exp:          FAR_FUTURE_SEC,
    });
    const a = await importAuthToken();
    expect((await a.getAuthToken())?.token).toBe("cached-tok");
    expect(await a.isAuthTokenValid()).toBe(true);
  });

  it("treats tokens within 60s of expiry as already gone (refresh skew)", async () => {
    const store = await importStore();
    const nowSec = Math.floor(Date.now() / 1000);
    await store.setAuthToken({
      token: "near-expiry", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: nowSec, exp: nowSec + 30, // 30s away
    });
    const a = await importAuthToken();
    expect(await a.getAuthToken()).toBeNull();
    // And it scrubs the storage entry so a stale read can't come back later.
    expect(chromeMock._store["proofline:auth-token"]).toBeUndefined();
  });

  it("clearAuthToken removes the storage entry", async () => {
    const store = await importStore();
    await store.setAuthToken({
      token: "byebye", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: 1, exp: FAR_FUTURE_SEC,
    });
    const a = await importAuthToken();
    expect(await a.getAuthToken()).not.toBeNull();
    await a.clearAuthToken();
    expect(chromeMock._store["proofline:auth-token"]).toBeUndefined();
  });

  it("getOrIssueAuthToken returns the cached token without opening a popup", async () => {
    const store = await importStore();
    await store.setAuthToken({
      token: "no-popup-needed", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: 1, exp: FAR_FUTURE_SEC,
    });
    const a = await importAuthToken();
    const token = await a.getOrIssueAuthToken();
    expect(token).toBe("no-popup-needed");
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
  });
});
