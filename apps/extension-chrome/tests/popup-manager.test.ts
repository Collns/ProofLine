/**
 * @file popup-manager.test.ts
 * @module apps/extension-chrome/tests
 *
 * Unit tests for the popup ceremony state machine. Strategy:
 *   - Mock chrome.* APIs with vi.fn() doubles backed by an in-memory
 *     storage map (the same backend mocking pattern auth-token /
 *     session-store / popup-launcher tests reuse via test-helpers).
 *   - Drive runCeremony() and assert it opens a window with the right
 *     URL / sizing / focus state.
 *   - Simulate the popup posting a response via handleCeremonyMessage.
 *   - Confirm the Promise resolves / rejects per the response kind.
 *   - Confirm chrome.storage.local has the auth token under the new
 *     proofline:auth-token key.
 *
 * These are NOT a real "clean Chrome profile" E2E — that requires
 * Playwright + a real browser, which lives in a separate harness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installChromeMock, type ChromeMock } from "./helpers/chrome-mock.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

let chromeMock: ChromeMock;
beforeEach(() => {
  chromeMock = installChromeMock();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  chromeMock.uninstall();
});

async function importPopupManager() {
  vi.resetModules();
  return await import("../src/background/popup-manager.js");
}
async function importSessionStore() {
  vi.resetModules();
  return await import("../src/background/session-store.js");
}

// Flush enough microtasks to let an awaited call chain through
// chrome.storage.local.get → chrome.windows.create → pendingCeremonies.set.
async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("popup-manager.runCeremony", () => {
  it("opens a popup window with the full URL-param contract", async () => {
    const mgr = await importPopupManager();

    const promise = mgr.runCeremony({
      kind:             "fresh",
      recipientSetHash: "rs_abc",
      payloadHash:      "ph_xyz",
      payloadB64:       "eyJrIjoidiJ9",
      credentialId:     "cred_1",
      extToken:         "tok_xyz",
    });
    promise.catch(() => {}); // suppress
    await flushMicrotasks();

    expect(chromeMock.windows.create).toHaveBeenCalledOnce();
    const opts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    expect(opts.type).toBe("popup");
    expect(opts.state).toBe("normal");
    expect(opts.focused).toBe(true);

    const url = new URL(opts.url as string);
    expect(url.pathname).toBe("/sign/start");
    expect(url.searchParams.get("kind")).toBe("fresh");
    expect(url.searchParams.get("ceremonyId")).toMatch(/^[0-9a-f-]{36}$/);
    expect(url.searchParams.get("extInstallId")).toBe("fakeextensionid0123456789abcdef");
    expect(url.searchParams.get("returnOrigin")).toBe(
      "chrome-extension://fakeextensionid0123456789abcdef",
    );
    expect(url.searchParams.get("recipientSetHash")).toBe("rs_abc");
    expect(url.searchParams.get("payloadHash")).toBe("ph_xyz");
    expect(url.searchParams.get("payloadB64")).toBe("eyJrIjoidiJ9");
    expect(url.searchParams.get("credentialId")).toBe("cred_1");
    expect(url.searchParams.get("extToken")).toBe("tok_xyz");

    // Resolve so vitest doesn't hold a dangling pending promise.
    const ceremonyId = url.searchParams.get("ceremonyId")!;
    await mgr.handleCeremonyMessage({
      kind:        "user_cancelled",
      ceremonyId,
    });
    await expect(promise).rejects.toThrow(/USER_CANCELLED/);
  });

  it("opens a 1x1 minimized window for kind='silent'", async () => {
    const mgr = await importPopupManager();

    const promise = mgr.runCeremony({
      kind:             "silent",
      recipientSetHash: "rs",
      payloadHash:      "ph",
      payloadB64:       "x",
      credentialId:     "c",
      extToken:         "t",
      sessionToken:     "sess_jws",
    });
    promise.catch(() => {});
    await flushMicrotasks();

    const opts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    expect(opts.state).toBe("minimized");
    expect(opts.focused).toBe(false);
    expect(opts.width).toBe(1);
    expect(opts.height).toBe(1);

    const url = new URL(opts.url as string);
    expect(url.pathname).toBe("/sign/silent");
    expect(url.searchParams.get("sessionToken")).toBe("sess_jws");

    const ceremonyId = url.searchParams.get("ceremonyId")!;
    await mgr.handleCeremonyMessage({ kind: "user_cancelled", ceremonyId });
    await expect(promise).rejects.toThrow();
  });

  it("rejects with USER_CANCELLED when the popup window is closed", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({ kind: "auth" });
    await flushMicrotasks();
    mgr.handleWindowClosed(99);
    await expect(promise).rejects.toThrow(/USER_CANCELLED/);
  });

  it("rejects with TIMEOUT when no response within the deadline", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({ kind: "auth" });
    promise.catch(() => {});
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/CEREMONY_TIMEOUT/);
  });

  it("rejects when the popup posts an error response", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({
      kind:             "fresh",
      recipientSetHash: "rs",
      payloadHash:      "ph",
    });
    promise.catch(() => {});
    await flushMicrotasks();

    const url = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const ceremonyId = new URL(url.url as string).searchParams.get("ceremonyId")!;

    await mgr.handleCeremonyMessage({
      kind:    "error",
      ceremonyId,
      code:    "POLICY_DENIED",
      message: "Co-sign required for amounts over $250k",
    });
    await expect(promise).rejects.toThrow(/POLICY_DENIED/);
  });

  it("closes the popup window after a sign_success response", async () => {
    const mgr = await importPopupManager();
    const promise = mgr.runCeremony({
      kind:             "fresh",
      recipientSetHash: "rs",
      payloadHash:      "ph",
    });
    await flushMicrotasks();

    const url = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const ceremonyId = new URL(url.url as string).searchParams.get("ceremonyId")!;

    await mgr.handleCeremonyMessage({
      kind:        "sign_success",
      ceremonyId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      envelope:    { v: 1, payloadHash: "ph" } as any,
      banner:      "<table>...</table>",
      sessionToken: "session-jws-789",
    });

    await promise;
    expect(chromeMock.windows.remove).toHaveBeenCalledWith(99);
  });

  it("persists auth token to chrome.storage.local on auth_success under proofline:auth-token", async () => {
    const mgr   = await importPopupManager();
    const store = await importSessionStore();

    const promise = mgr.runCeremony({ kind: "auth" });
    await flushMicrotasks();

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

    const got = await store.getAuthToken();
    expect(got?.token).toBe("ext-jws-abc");
    expect(got?.userId).toBe("user_42");
    expect(got?.companyId).toBe("co_42");
    expect(got?.extInstallId).toBe("fakeextensionid0123456789abcdef");
    expect(typeof got?.iat).toBe("number");
    expect(typeof got?.exp).toBe("number");

    const dump = await store.dumpAll();
    expect(Object.keys(dump)).toEqual(["proofline:auth-token"]);
  });

  it("ignores responses for unknown ceremonyIds without crashing", async () => {
    const mgr = await importPopupManager();
    const handled = await mgr.handleCeremonyMessage({
      kind:       "sign_success",
      ceremonyId: "nonexistent-uuid",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      envelope:   {} as any,
      banner:     "",
    });
    expect(handled).toBe(true);
  });

  it("ignores malformed messages", async () => {
    const mgr = await importPopupManager();
    expect(await mgr.handleCeremonyMessage(null)).toBe(false);
    expect(await mgr.handleCeremonyMessage({ random: "stuff" })).toBe(false);
    expect(await mgr.handleCeremonyMessage({ kind: "weird" })).toBe(false);
  });
});
