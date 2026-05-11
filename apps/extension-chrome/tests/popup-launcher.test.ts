import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installChromeMock, type ChromeMock } from "./helpers/chrome-mock.js";

let chromeMock: ChromeMock;
beforeEach(() => {
  chromeMock = installChromeMock();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  chromeMock.uninstall();
});

async function importLauncher() {
  vi.resetModules();
  return await import("../src/background/popup-launcher.js");
}
async function importManager() {
  return await import("../src/background/popup-manager.js");
}
async function importStore() {
  return await import("../src/background/session-store.js");
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

const FAR_FUTURE_SEC = Math.floor(Date.now() / 1000) + 24 * 3600;

async function seedAuthToken(token = "stored-tok") {
  const store = await importStore();
  await store.setAuthToken({
    token,
    userId:       "u1",
    companyId:    "co1",
    extInstallId: "ext_1",
    iat:          Math.floor(Date.now() / 1000),
    exp:          FAR_FUTURE_SEC,
  });
}

describe("openPopupCeremony", () => {
  it("includes every required URL param when launching kind='fresh'", async () => {
    await seedAuthToken("fresh-tok");
    const launcher = await importLauncher();
    const manager  = await importManager();

    const promise = launcher.openPopupCeremony({
      kind:             "fresh",
      payloadB64:       "eyJ4Ijoxfg",
      payloadHash:      "deadbeef",
      recipientSetHash: "rs_1",
      credentialId:     "cred_42",
    });
    promise.catch(() => {});
    await flushMicrotasks();

    const opts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const url  = new URL(opts.url as string);
    expect(url.searchParams.get("kind")).toBe("fresh");
    expect(url.searchParams.get("payloadB64")).toBe("eyJ4Ijoxfg");
    expect(url.searchParams.get("payloadHash")).toBe("deadbeef");
    expect(url.searchParams.get("recipientSetHash")).toBe("rs_1");
    expect(url.searchParams.get("credentialId")).toBe("cred_42");
    expect(url.searchParams.get("extToken")).toBe("fresh-tok");
    expect(url.searchParams.get("returnOrigin")).toBe(
      "chrome-extension://fakeextensionid0123456789abcdef",
    );

    // Resolve so the test doesn't leak a pending promise.
    const ceremonyId = url.searchParams.get("ceremonyId")!;
    await manager.handleCeremonyMessage({
      kind: "user_cancelled",
      ceremonyId,
    });
    await expect(promise).rejects.toThrow();
  });

  it("opens silent ceremony minimized with sessionToken propagated", async () => {
    await seedAuthToken();
    const launcher = await importLauncher();
    const manager  = await importManager();

    const promise = launcher.openPopupCeremony({
      kind:             "silent",
      payloadB64:       "x",
      payloadHash:      "h",
      recipientSetHash: "rs",
      credentialId:     "c",
      sessionToken:     "sess_jws_abc",
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
    expect(url.searchParams.get("sessionToken")).toBe("sess_jws_abc");

    const ceremonyId = url.searchParams.get("ceremonyId")!;
    await manager.handleCeremonyMessage({
      kind: "user_cancelled",
      ceremonyId,
    });
    await expect(promise).rejects.toThrow();
  });

  it("auth ceremony does NOT include extToken in the URL", async () => {
    const launcher = await importLauncher();
    const manager  = await importManager();

    const promise = launcher.openPopupCeremony({ kind: "auth" });
    promise.catch(() => {});
    await flushMicrotasks();

    const opts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const url  = new URL(opts.url as string);
    expect(url.pathname).toBe("/extension/auth");
    expect(url.searchParams.get("kind")).toBe("auth");
    expect(url.searchParams.get("extToken")).toBeNull();

    const ceremonyId = url.searchParams.get("ceremonyId")!;
    await manager.handleCeremonyMessage({
      kind: "user_cancelled",
      ceremonyId,
    });
    await expect(promise).rejects.toThrow();
  });

  it("rejects with AUTH_REQUIRED when no token is stored and the auth popup is cancelled", async () => {
    const launcher = await importLauncher();
    const manager  = await importManager();

    const promise = launcher.openPopupCeremony({
      kind:             "fresh",
      payloadB64:       "x",
      payloadHash:      "h",
      recipientSetHash: "rs",
      credentialId:     "c",
    });
    promise.catch(() => {});

    // The launcher first opens an auth ceremony to mint a token.
    await flushMicrotasks();

    const firstWindow = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    expect(new URL(firstWindow.url as string).pathname).toBe("/extension/auth");

    // User cancels the auth popup → launcher should surface AUTH_REQUIRED.
    const ceremonyId = new URL(firstWindow.url as string).searchParams.get("ceremonyId")!;
    await manager.handleCeremonyMessage({
      kind:       "user_cancelled",
      ceremonyId,
    });

    await expect(promise).rejects.toThrow(/AUTH_REQUIRED/);
  });

  it("times out after 60s if the popup never responds", async () => {
    await seedAuthToken();
    const launcher = await importLauncher();

    const promise = launcher.openPopupCeremony({
      kind:             "fresh",
      payloadB64:       "x",
      payloadHash:      "h",
      recipientSetHash: "rs",
      credentialId:     "c",
    });
    promise.catch(() => {});
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    await expect(promise).rejects.toThrow(/CEREMONY_TIMEOUT/);
  });

  it("closes the popup window when sign_success arrives", async () => {
    await seedAuthToken();
    const launcher = await importLauncher();
    const manager  = await importManager();

    const promise = launcher.openPopupCeremony({
      kind:             "fresh",
      payloadB64:       "x",
      payloadHash:      "h",
      recipientSetHash: "rs",
      credentialId:     "c",
    });
    await flushMicrotasks();

    const opts = chromeMock.windows.create.mock.calls[0][0] as chrome.windows.CreateData;
    const ceremonyId = new URL(opts.url as string).searchParams.get("ceremonyId")!;

    await manager.handleCeremonyMessage({
      kind:        "sign_success",
      ceremonyId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      envelope:    { v: 1, payloadHash: "h" } as any,
      banner:      "<table>...</table>",
      sessionToken: "session-jws-1",
    });

    const result = await promise;
    expect(result.kind).toBe("sign_success");
    expect(chromeMock.windows.remove).toHaveBeenCalled();
  });
});
