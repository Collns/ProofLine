import { describe, it, expect } from 'vitest';
import { formatWireAmount } from '../format';

// PFL-183: same whole-dollar convention as the verify page and web-sign.
describe('formatWireAmount', () => {
  it('renders whole-dollar wire amounts without a cents conversion', () => {
    expect(formatWireAmount(400_000)).toBe('$400,000.00');
    expect(formatWireAmount(1_250)).toBe('$1,250.00');
  });
});
