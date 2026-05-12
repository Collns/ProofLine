import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliverToOpener, type CeremonyResponse } from '../postmessage';

const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';
const VALID_ORIGIN = `chrome-extension://${VALID_ID}`;

const SUCCESS_RESPONSE: CeremonyResponse = {
  kind: 'sign_success',
  ceremonyId: 'cer-1',
  envelope: { dummy: true } as unknown as CeremonyResponse extends { envelope: infer E } ? E : never,
  banner: '<div>banner</div>',
  sessionToken: 'jws.payload.sig',
};

describe('deliverToOpener', () => {
  beforeEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('returns { delivered: false, via: "none" } when no chrome.runtime and no window.opener', async () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    const result = await deliverToOpener(SUCCESS_RESPONSE, {
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.delivered).toBe(false);
    expect(result.via).toBe('none');
  });

  it('uses chrome.runtime.sendMessage when chrome.runtime is present', async () => {
    const sendMessage = vi.fn(
      (_id: string, _msg: unknown, cb?: (resp: unknown) => void) => {
        cb?.(undefined);
      },
    );
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage },
    };

    const result = await deliverToOpener(SUCCESS_RESPONSE, {
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });

    expect(sendMessage).toHaveBeenCalledWith(VALID_ID, SUCCESS_RESPONSE, expect.any(Function));
    expect(result.via).toBe('chrome.runtime');
    expect(result.delivered).toBe(true);
  });

  it('falls back to window.opener.postMessage with explicit chrome-extension:// targetOrigin', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { postMessage },
    });

    const result = await deliverToOpener(SUCCESS_RESPONSE, {
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(SUCCESS_RESPONSE, VALID_ORIGIN);
    // Crucially never '*'
    expect((postMessage.mock.calls[0] as unknown[])[1]).not.toBe('*');
    expect(result.via).toBe('window.opener');
    expect(result.delivered).toBe(true);
  });

  it('CeremonyResponse union covers auth_success / sign_success / user_cancelled / error', () => {
    // Compile-time check — the union shape must accept each branch.
    const variants: CeremonyResponse[] = [
      {
        kind: 'auth_success',
        ceremonyId: 'cer-1',
        authToken: 't',
        userId: 'u',
        companyId: 'c',
        email: 'u@example.com',
        credentialId: 'placeholder-credential-id',
      },
      {
        kind: 'sign_success',
        ceremonyId: 'cer-1',
        envelope: {} as never,
        banner: '<div/>',
      },
      { kind: 'user_cancelled', ceremonyId: 'cer-1' },
      { kind: 'error', ceremonyId: 'cer-1', code: 'X', message: 'm' },
    ];
    expect(variants).toHaveLength(4);
  });
});
