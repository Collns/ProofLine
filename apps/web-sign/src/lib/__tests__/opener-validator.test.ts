import { describe, it, expect } from 'vitest';
import { validateOpener, validateOpenerFromWindow } from '../opener-validator';

const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 chars in a–p
const VALID_ORIGIN = `chrome-extension://${VALID_ID}`;

describe('validateOpener', () => {
  it('accepts a valid chrome-extension opener with matching extInstallId', () => {
    const result = validateOpener({
      hasOpener: true,
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extInstallId).toBe(VALID_ID);
      expect(result.returnOrigin).toBe(VALID_ORIGIN);
    }
  });

  it('rejects when window.opener is null (page surfed to directly)', () => {
    const result = validateOpener({
      hasOpener: false,
      extInstallId: VALID_ID,
      returnOrigin: VALID_ORIGIN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_OPENER');
  });

  it('rejects http:// returnOrigin (only chrome-extension:// allowed)', () => {
    const result = validateOpener({
      hasOpener: true,
      extInstallId: VALID_ID,
      returnOrigin: 'https://attacker.example.com',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_RETURN_ORIGIN');
  });

  it('rejects extInstallId that does not match the 32-char a–p format', () => {
    const result = validateOpener({
      hasOpener: true,
      extInstallId: 'too-short',
      returnOrigin: 'chrome-extension://too-short',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_EXT_ID');
  });

  it('rejects when returnOrigin extension id does not match extInstallId', () => {
    const otherId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const result = validateOpener({
      hasOpener: true,
      extInstallId: VALID_ID,
      returnOrigin: `chrome-extension://${otherId}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_RETURN_ORIGIN');
  });

  it('rejects when extInstallId is missing', () => {
    const result = validateOpener({
      hasOpener: true,
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

  it('detects null opener via window.opener', () => {
    const fakeWindow = { opener: null } as unknown as Window;
    const search = `?extInstallId=${VALID_ID}&returnOrigin=${encodeURIComponent(VALID_ORIGIN)}`;
    const result = validateOpenerFromWindow(fakeWindow, search);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_OPENER');
  });
});
