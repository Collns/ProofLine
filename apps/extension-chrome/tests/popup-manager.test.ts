/**
 * @file popup-manager.test.ts
 * @module apps/extension-chrome/tests
 *
 * Unit / integration tests for the PFL-044 popup ceremony bridge.
 *
 * These are NOT a real "clean Chrome profile" E2E — that requires
 * Playwright + a real browser, which lives in a separate harness.
 * What we cover here is the message wiring, ceremony state machine,
 * and chrome.storage.local persistence — everything that doesn't
 * need a real WebAuthn authenticator.
 *
 * Strategy:
 *   - Mock chrome.* APIs with vi.fn() doubles.
 *   - Drive runCeremony() and assert it opens a window.
 *   - Simulate the popup posting a response via handleCeremonyMessage.
 *   - Confirm the Promise resolves with the popup's payload.
 *   - Confirm chrome.storage.local has the auth token / session token.
 *   - Cover error paths: user closes popup, timeout, malformed messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── chrome.* mocks ───────────────────────────────────────────────────────────

interface ChromeStorageBackend {
  store: Record<string, unknown>;
}

function makeChromeMock() {
  const storage: ChromeStorageBackend = { store: {} };
  const onMessageExternalListeners: Array<(...a: unknown[]) => unknown> = [];
  const onMessageListeners:         Array<(...a: unknown[]) => unknown> = [];
  const onWindowsRemovedListeners:  Array<(windowId: number) => void>   = [];

  const chromeMock = {
    runtime: {
      id: "fakeextensionid0123456789abcdef",
      onMessageExternal: { addListener: (fn: any) => onMessageExternalListeners.push(fn) },
      onMessage:         { addListener: (fn: any) => onMessageListeners.push(fn) },
      onInstalled:       { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) return { ...storage.store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in storage.store) out[k] = storage.store[k];
          }
          return out;
        }),
        set: vi.fn(async (kv: Record<string, unknown>) => {
          Object.assign(storage.store, kv);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storage.store[k];
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(storage.store)) delete storage.store[k];
        }),
      },
    },
    windows: {
      create: vi.fn(async (_opts: chrome.windows.CreateData) => ({
        id: 99 as number,
      } as chrome.windows.Window)),
      remove: vi.fn(async (_id: number) => {}),
      onRemoved: { addListener: (fn: any) => onWindowsRemovedListeners.push(fn) },
    },
    _backend: storage,
    _fireWindowRemoved: (id: number) => onWindowsRemovedListeners.forEach((fn) => fn(id)),
    _fireExternalMessage: (msg: unknown, sender: { url?: string }) => {
      const responses: unknown[] = [];
      onMessageExternalListeners.forEach((fn) => {
        fn(msg, sender, (r: unknown) => responses.push(r));
      });
      return responses;
    },
  };

  return chromeMock;
}

// Install a global chrome.* mock that resets between tests.
let chromeMock: ReturnType<typeof makeChromeMock>;
beforeEach(() => {
  chromeMock = makeChromeMock();
  (globalThis as any).chrome = chromeMock;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).chrome;
});

// Lazy-import after chrome.* is in place (modules read chrome.runtime at load).
async function importPopupManager() {
  vi.resetModules();
  return await import("../src/background/popup-manager.js");
}
async function importSessionStore() {
  vi.resetModules();
  return await import("../src/background/session-store.js");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("session-store", () => {
  it("returns null when no auth token is set", async () => {
    const store = await importSessionStore();
    expect(await store.getAuthToken()).toBeNull();
  });

  it("round-trips an auth token", async () => {
    const store = await importSessionStore();
    await store.setAuthToken({
      token:     "jws-abc",
      userId:    "user_1",
      companyId: "co_1",
      expiresAt: Date.now() + 60_000,
    });
    const got = await store.getAuthToken();
    expect(got?.token).toBe("jws-abc");
    expect(got?.userId).toBe("user_1");
  });

  it("clears expired auth tokens on read", async () => {
    const store = await importSessionStore();
    await store.setAuthToken({
      token:     "jws-old",
      userId:    "user_1",
      companyId: "co_1",
      expiresAt: Date.now() - 1_000,  // already expired
    });
    expect(await store.getAuthToken()).toBeNull();
    // Verify it's actually gone from storage too:
    expect(await store.dumpAll()).toEqual({});
  });

  it("logout() clears every key in storage", async () => {
    const store = await importSessionStore();
    await store.setAuthToken({
      token: "t", userId: "u", companyId: "c",
      expiresAt: Date.now() + 60_000,
    });
    await store.setSession({
      token: "s", recipientSetHash: "rs1",
      expiresAt: Date.now() + 60_000, createdAt: Date.now(),
    });
    expect(Object.keys(await store.dumpAll())).toHaveLength(5); // 4 auth + 1 session
    await store.logout();
    expect(Object.keys(await store.dumpAll())).toHaveLength(0);
  });

  it("sessions are scoped per recipient-set", async () => {
    const store = await importSessionStore();
    const now = Date.now();
    await store.setSession({ token: "s1", recipientSetHash: "rsA", expiresAt: now + 60_000, createdAt: now });
    await store.setSession({ token: "s2", recipientSetHash: "rsB", expiresAt: now + 60_000, createdAt: now });
    expect((await store.getSession("rsA"))?.token).toBe("s1");
    expect((await store.getSession("rsB"))?.token).toBe("s2");
    expect(await store.getSession("rsZ")).toBeNull();
  });
});

describe("popup-manager.runCeremony", () => {
  it("opens a popup window with the correct URL and parameters", async () => {
    const mgr = await importPopupManager();

    // Kick off — don't await yet, we need to simulate the popup posting back.
    const promise = mgr.runCeremony({
      kind:             "fresh",
      recipientSetHash: "rs_abc",
      payloadHash:      "ph_xyz",
    });

    // Verify chrome.windows.create was called with a /sign/start URL.
    expect(chromeMock.windows.create).toHaveBeenCalledOnce();
    const createOpts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    expect(createOpts.type).toBe("popup");
    expect(createOpts.url).toContain("https://app.proofline.web.app/sign/start");
    expect(createOpts.url).toContain("recipientSetHash=rs_abc");
    expect(createOpts.url).toContain("payloadHash=ph_xyz");

    // Extract the ceremonyId from the URL the manager generated.
    const url   = new URL(createOpts.url as string);
    const ceremonyId = url.searchParams.get("ceremonyId")!;
    expect(ceremonyId).toMatch(/^[0-9a-f-]{36}$/);

    await Promise.resolve();
    await Promise.resolve();

    // Simulate the popup posting a sign_success response.
    await mgr.handleCeremonyMessage({
      kind:        "sign_success",
      ceremonyId,
      envelope:    { v: 1, payloadHash: "ph_xyz" } as any,
      banner:      "<table>...</table>",
      sessionToken: "session-jws-789",
    });

    const result = await promise;
    expect(result.kind).toBe("sign_success");

    // Popup window should be closed.
    expect(chromeMock.windows.remove).toHaveBeenCalledWith(99);
  });

  it("rejects with USER_CANCELLED when the popup window is closed", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({ kind: "auth" });

    // Wait for chrome.windows.create to settle.
    await Promise.resolve();
    await Promise.resolve();

    // Simulate user closing the popup.
    mgr.handleWindowClosed(99);

    await expect(promise).rejects.toThrow(/USER_CANCELLED/);
  });

   it("rejects with TIMEOUT when no response within the deadline", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({ kind: "auth" });
    promise.catch(() => {}); // suppress unhandled rejection

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);

    await expect(promise).rejects.toThrow(/CEREMONY_TIMEOUT/);
  });

  it("rejects when the popup posts an error response", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({ kind: "fresh", recipientSetHash: "rs", payloadHash: "ph" });
    await Promise.resolve(); await Promise.resolve();

    const url = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const ceremonyId = new URL(url.url as string).searchParams.get("ceremonyId")!;

    await mgr.handleCeremonyMessage({
      kind:       "error",
      ceremonyId,
      code:       "POLICY_DENIED",
      message:    "Co-sign required for amounts over $250k",
    });

    await expect(promise).rejects.toThrow(/POLICY_DENIED/);
  });

  it("persists auth token to chrome.storage.local on auth_success", async () => {
    const mgr   = await importPopupManager();
    const store = await importSessionStore();

    const promise = mgr.runCeremony({ kind: "auth" });
    await Promise.resolve(); await Promise.resolve();

    const url = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const ceremonyId = new URL(url.url as string).searchParams.get("ceremonyId")!;

    await mgr.handleCeremonyMessage({
      kind:      "auth_success",
      ceremonyId,
      authToken: "ext-jws-abc",
      userId:    "user_42",
      companyId: "co_42",
    });

    await promise;

    // Verify the token landed in storage.
    const got = await store.getAuthToken();
    expect(got?.token).toBe("ext-jws-abc");
    expect(got?.userId).toBe("user_42");
  });

  it("ignores responses for unknown ceremonyIds without crashing", async () => {
    const mgr = await importPopupManager();
    const handled = await mgr.handleCeremonyMessage({
      kind:       "sign_success",
      ceremonyId: "nonexistent-uuid",
      envelope:   {} as any,
      banner:     "",
    });
    // Returns true (recognized message format) but doesn't resolve anything.
    expect(handled).toBe(true);
  });

  it("ignores malformed messages", async () => {
    const mgr = await importPopupManager();
    expect(await mgr.handleCeremonyMessage(null)).toBe(false);
    expect(await mgr.handleCeremonyMessage({ random: "stuff" })).toBe(false);
    expect(await mgr.handleCeremonyMessage({ kind: "weird" })).toBe(false);
  });

  it("token persists across simulated service-worker restart", async () => {
    // First "lifetime": save a token.
    {
      const store = await importSessionStore();
      await store.setAuthToken({
        token: "persist-me", userId: "u", companyId: "c",
        expiresAt: Date.now() + 60_000,
      });
    }

    // Re-import module to simulate the SW being torn down and reloaded.
    // chrome.storage.local survives because it's backed by the persistent store.
    {
      const store = await importSessionStore();
      const got = await store.getAuthToken();
      expect(got?.token).toBe("persist-me");
    }
  });

  it("token is cleared on logout", async () => {
    const store = await importSessionStore();

    await store.setAuthToken({
      token: "logout-me", userId: "u", companyId: "c",
      expiresAt: Date.now() + 60_000,
    });
    await store.setSession({
      token: "s", recipientSetHash: "rs",
      expiresAt: Date.now() + 60_000, createdAt: Date.now(),
    });

    await store.logout();

    expect(await store.getAuthToken()).toBeNull();
    expect(await store.getSession("rs")).toBeNull();
  });
});