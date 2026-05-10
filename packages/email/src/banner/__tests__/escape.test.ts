import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../escape.js';

describe('escapeHtml', () => {
  it('escapes & first so other entities are not double-escaped', () => {
    expect(escapeHtml('Tom & Jerry <tom@example.com>')).toBe(
      'Tom &amp; Jerry &lt;tom@example.com&gt;',
    );
    // No "&amp;amp;" double-escape — &lt; stays &lt;, never &amp;lt;
    expect(escapeHtml('a&b<c')).toBe('a&amp;b&lt;c');
    expect(escapeHtml('a&b<c')).not.toContain('&amp;lt;');
  });

  it('escapes <, >, ", and \' correctly', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('preserves regular text untouched', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
    expect(escapeHtml('Acme Title — Verified.')).toBe('Acme Title — Verified.');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles a realistic XSS attempt', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });
});
