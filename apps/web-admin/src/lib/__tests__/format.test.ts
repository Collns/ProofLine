import { describe, it, expect } from 'vitest';

import { isValidZip, ZIP_REGEX, normalizeEin } from '../format';

describe('isValidZip (PFL-162 onboarding address)', () => {
  it('accepts an empty value — the business address is optional', () => {
    expect(isValidZip('')).toBe(true);
    expect(isValidZip('   ')).toBe(true);
  });

  it('accepts a 5-digit ZIP and ZIP+4, trimming whitespace', () => {
    expect(isValidZip('94105')).toBe(true);
    expect(isValidZip('94105-1234')).toBe(true);
    expect(isValidZip('  94105  ')).toBe(true);
  });

  it('rejects malformed ZIPs', () => {
    expect(isValidZip('9410')).toBe(false);
    expect(isValidZip('941050')).toBe(false);
    expect(isValidZip('94105-12')).toBe(false);
    expect(isValidZip('ABCDE')).toBe(false);
  });

  it('ZIP_REGEX matches the server start-handler pattern', () => {
    expect(ZIP_REGEX.test('94105')).toBe(true);
    expect(ZIP_REGEX.test('94105-1234')).toBe(true);
    expect(ZIP_REGEX.test('')).toBe(false);
  });
});

describe('normalizeEin', () => {
  it('formats 9 digits as XX-XXXXXXX', () => {
    expect(normalizeEin('123456789')).toBe('12-3456789');
    expect(normalizeEin('12-3456789')).toBe('12-3456789');
  });

  it('leaves non-9-digit input untouched', () => {
    expect(normalizeEin('123')).toBe('123');
  });
});
