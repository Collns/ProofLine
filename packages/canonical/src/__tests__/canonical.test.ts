import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const goldenVectors: Array<{ input: unknown; expected: string }> = JSON.parse(
  readFileSync(join(__dir, '../__fixtures__/golden.json'), 'utf8'),
);

describe('canonicalize (RFC 8785 JCS)', () => {
  // Adding new vectors is fine; modifying existing ones requires intentional
  // review since all signatures in the system depend on canonical bytes.
  it('golden vectors are intentionally stable', () => {
    expect(goldenVectors.length).toBeGreaterThanOrEqual(13);
  });

  it.each(goldenVectors)('canonicalizes $expected', ({ input, expected }) => {
    const result = new TextDecoder().decode(canonicalize(input));
    expect(result).toBe(expected);
  });

  it('throws on undefined input', () => {
    expect(() => canonicalize(undefined)).toThrow('canonicalize');
  });

  it('returns Uint8Array', () => {
    const result = canonicalize({});
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('output is valid UTF-8 JSON', () => {
    const result = canonicalize({ z: 1, a: 2 });
    const str = new TextDecoder().decode(result);
    expect(() => JSON.parse(str)).not.toThrow();
  });
});
