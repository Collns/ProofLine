import { describe, it, expect } from 'vitest';
import { validateOpener, validateOpenerFromWindow } from '../opener-validator';

const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 chars in a–p
const VALID_ORIGIN = `chrome-extension://${VALID_ID}`;

describe('validateOpener', () => {
  it('accepts a valid extInstallId + matching returnOrigin', () => {
    const result = validateOpener({
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extInstallId).toBe(VALID_ID);
      expect(result.returnOrigin).toBe(VALID_ORIGIN);
    }
  });

  it('accepts even when no window.opener exists (chrome.windows.create has none)', () => {
    // The launcher uses chrome.windows.create(), which always gives the
    // popup `window.opener === null`. Validation must still pass.
    const result = validateOpener({
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects http:// returnOrigin (only chrome-extension:// allowed)', () => {
    const result = validateOpener({
      extInstallId: VALID_ID,
      returnOrigin: 'https://attacker.example.com',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_RETURN_ORIGIN');
  });

  it('rejects extInstallId that does not match the 32-char a–p format', () => {
    const result = validateOpener({
      extInstallId: 'too-short',
      returnOrigin: 'chrome-extension://too-short',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_EXT_ID');
  });

  it('rejects when returnOrigin extension id does not match extInstallId', () => {
    const otherId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const result = validateOpener({
      extInstallId: VALID_ID,
      returnOrigin: `chrome-extension://${otherId}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_RETURN_ORIGIN');
  });

  it('rejects when extInstallId is missing', () => {
    const result = validateOpener({
      extInstallId: null,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_EXT_ID');
  });
});

describe('validateOpenerFromWindow', () => {
  it('reads extInstallId and returnOrigin from URL search params', () => {
    const fakeWindow = { opener: {} } as unknown as Window;
    const search = `?extInstallId=${VALID_ID}&returnOrigin=${encodeURIComponent(VALID_ORIGIN)}`;
    const result = validateOpenerFromWindow(fakeWindow, search);
    expect(result.ok).toBe(true);
  });

  it('passes even when window.opener is null (chrome.windows.create case)', () => {
    const fakeWindow = { opener: null } as unknown as Window;
    const search = `?extInstallId=${VALID_ID}&returnOrigin=${encodeURIComponent(VALID_ORIGIN)}`;
    const result = validateOpenerFromWindow(fakeWindow, search);
    expect(result.ok).toBe(true);
  });
});
