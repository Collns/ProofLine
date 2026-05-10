import { describe, it, expect } from 'vitest';
import { parseBulkEmails } from '../BulkEmailParser';
import { BULK_LIMIT } from '../../api/invitations-client';

describe('parseBulkEmails', () => {
  it('parses one-per-line input', () => {
    const out = parseBulkEmails('a@x.com\nb@x.com\nc@x.com');
    expect(out.valid).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    expect(out.invalid).toEqual([]);
    expect(out.duplicates).toEqual([]);
  });

  it('parses comma-separated and semicolon-separated input', () => {
    const out = parseBulkEmails('a@x.com, b@x.com; c@x.com');
    expect(out.valid).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('handles mixed whitespace, tabs, and blank lines', () => {
    const input = '  a@x.com\n\n\tb@x.com   \n\n   c@x.com  ';
    const out = parseBulkEmails(input);
    expect(out.valid).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('deduplicates case-insensitively and preserves first occurrence', () => {
    const out = parseBulkEmails('Alice@X.com, alice@x.com, ALICE@X.COM');
    expect(out.valid).toEqual(['Alice@X.com']);
    expect(out.duplicates).toHaveLength(2);
    expect(out.duplicates).toEqual(['alice@x.com', 'ALICE@X.COM']);
  });

  it('rejects malformed email shapes', () => {
    // Whitespace splits "garbage with@spaces" into separate tokens, so
    // we cover only shapes that are unambiguously malformed.
    const out = parseBulkEmails('not-an-email\nfoo@\n@bar.com\ntrailing-dot@x.\nok@x.com');
    expect(out.valid).toEqual(['ok@x.com']);
    expect(out.invalid).toEqual(['not-an-email', 'foo@', '@bar.com', 'trailing-dot@x.']);
  });

  it('caps valid emails at BULK_LIMIT and reports overLimit', () => {
    const many = Array.from({ length: BULK_LIMIT + 5 }, (_, i) => `u${i}@x.com`).join('\n');
    const out = parseBulkEmails(many);
    expect(out.valid).toHaveLength(BULK_LIMIT);
    expect(out.overLimit).toBe(true);
  });

  it('returns empty result for empty input', () => {
    const out = parseBulkEmails('   \n\n\t  ');
    expect(out.valid).toEqual([]);
    expect(out.invalid).toEqual([]);
    expect(out.duplicates).toEqual([]);
    expect(out.overLimit).toBe(false);
  });
});
