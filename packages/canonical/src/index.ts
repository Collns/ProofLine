import canonicalize from 'canonicalize';

/**
 * Canonicalize a JSON value per RFC 8785 (JCS).
 * Returns UTF-8 encoded bytes ready for hashing or signing.
 *
 * Key properties:
 *   - Lexicographic key ordering (recursive)
 *   - No whitespace
 *   - Number normalization per RFC 8785
 *   - Stable across all conforming implementations
 */
export function canonicalize_(value: unknown): Uint8Array {
  const json = canonicalize(value);
  if (json === undefined) {
    throw new Error('canonicalize: value contains undefined or symbols');
  }
  return new TextEncoder().encode(json);
}

// Export under a clean name (avoiding collision with the npm package)
export { canonicalize_ as canonicalize };
