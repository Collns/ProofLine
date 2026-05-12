import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeMock, type ChromeMock } from "./helpers/chrome-mock.js";

let chromeMock: ChromeMock;
beforeEach(() => {
  chromeMock = installChromeMock();
});
afterEach(() => {
  chromeMock.uninstall();
});

async function importStore() {
  vi.resetModules();
  return await import("../src/background/session-store.js");
}

describe("session-store key namespacing", () => {
  it("writes the auth token under proofline:auth-token", async () => {
    const store = await importStore();
    const nowSec = Math.floor(Date.now() / 1000);
    await store.setAuthToken({
      token:        "tok_a",
      userId:       "user_1",
      companyId:    "co_1",
      extInstallId: "ext_1",
      iat:          nowSec,
      exp:          nowSec + 3600,
    });
    expect(Object.keys(chromeMock._store)).toEqual(["proofline:auth-token"]);
    expect(chromeMock._store["proofline:auth-token"]).toMatchObject({
      token:     "tok_a",
      userId:    "user_1",
      companyId: "co_1",
    });
  });

  it("writes session entries under proofline:session:<hash>", async () => {
    const store = await importStore();
    const now = Date.now();
    await store.setSession({
      token:            "sess_1",
      recipientSetHash: "rs_abc",
      expiresAt:        now + 60_000,
      hardCapAt:        now + 8 * 3600 * 1000,
      storedAt:         now,
    });
    expect(Object.keys(chromeMock._store)).toEqual(["proofline:session:rs_abc"]);
  });
});

describe("session-store auth lifecycle", () => {
  it("getAuthToken returns null when no token is set", async () => {
    const store = await importStore();
    expect(await store.getAuthToken()).toBeNull();
  });

  it("clears expired auth tokens on read", async () => {
    const store = await importStore();
    const past = Math.floor(Date.now() / 1000) - 10;
    await store.setAuthToken({
      token: "expired", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: past - 100, exp: past,
    });
    expect(await store.getAuthToken()).toBeNull();
    expect(chromeMock._store["proofline:auth-token"]).toBeUndefined();
  });

  it("rejects malformed records as null", async () => {
    const store = await importStore();
    chromeMock._store["proofline:auth-token"] = { token: "x" }; // missing fields
    expect(await store.getAuthToken()).toBeNull();
  });
});

describe("session-store per-recipient sessions", () => {
  it("returns null and deletes the entry when expiresAt has passed", async () => {
    const store = await importStore();
    const past = Date.now() - 1000;
    await store.setSession({
      token: "stale", recipientSetHash: "rs",
      expiresAt: past, hardCapAt: past + 1_000_000, storedAt: past,
    });
    expect(await store.getSession("rs")).toBeNull();
    expect(chromeMock._store["proofline:session:rs"]).toBeUndefined();
  });

  it("returns null and deletes when hardCapAt has passed even if expiresAt has not", async () => {
    const store = await importStore();
    const now = Date.now();
    await store.setSession({
      token: "capped", recipientSetHash: "rs",
      expiresAt: now + 60_000, hardCapAt: now - 1, storedAt: now - 1000,
    });
    expect(await store.getSession("rs")).toBeNull();
  });

  it("scopes sessions independently by recipientSetHash", async () => {
    const store = await importStore();
    const now = Date.now();
    await store.setSession({ token: "s1", recipientSetHash: "rsA", expiresAt: now + 60_000, hardCapAt: now + 1_000_000, storedAt: now });
    await store.setSession({ token: "s2", recipientSetHash: "rsB", expiresAt: now + 60_000, hardCapAt: now + 1_000_000, storedAt: now });
    expect((await store.getSession("rsA"))?.token).toBe("s1");
    expect((await store.getSession("rsB"))?.token).toBe("s2");
    expect(await store.getSession("rsZ")).toBeNull();
  });

  it("clearAllSessions removes only the session: keys, leaving auth alone", async () => {
    const store = await importStore();
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    await store.setAuthToken({
      token: "keep", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: nowSec, exp: nowSec + 3600,
    });
    await store.setSession({ token: "s1", recipientSetHash: "rsA", expiresAt: now + 60_000, hardCapAt: now + 1_000_000, storedAt: now });
    await store.setSession({ token: "s2", recipientSetHash: "rsB", expiresAt: now + 60_000, hardCapAt: now + 1_000_000, storedAt: now });

    await store.clearAllSessions();
    expect(Object.keys(chromeMock._store)).toEqual(["proofline:auth-token"]);
    expect((await store.getAuthToken())?.token).toBe("keep");
  });

  it("logout() clears every key in storage", async () => {
    const store = await importStore();
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    await store.setAuthToken({
      token: "t", userId: "u", companyId: "c", email: "u@example.com",
      extInstallId: "e", iat: nowSec, exp: nowSec + 3600,
    });
    await store.setSession({ token: "s", recipientSetHash: "rs", expiresAt: now + 60_000, hardCapAt: now + 1_000_000, storedAt: now });
    await store.logout();
    expect(Object.keys(chromeMock._store)).toEqual([]);
  });
});
