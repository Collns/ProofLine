import { describe, it, expect } from 'vitest';
import { formatWireAmount } from '../format';

describe('formatWireAmount', () => {
  it('formats whole dollars without a cents conversion', () => {
    expect(formatWireAmount(25_000)).toBe('$25,000.00');
    expect(formatWireAmount(400_000)).toBe('$400,000.00');
  });
});
