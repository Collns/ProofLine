import { describe, it, expect } from 'vitest';
import { formatWireAmount } from '../format';

// PFL-183: WirePayload.amount is whole US dollars; the verify page must not
// divide by 100 (a $400,000 wire once rendered as $4,000.00).
describe('formatWireAmount', () => {
  it('renders whole-dollar wire amounts without a cents conversion', () => {
    expect(formatWireAmount(400_000)).toBe('$400,000.00');
    expect(formatWireAmount(25_000)).toBe('$25,000.00');
    expect(formatWireAmount(0)).toBe('$0.00');
  });
});
