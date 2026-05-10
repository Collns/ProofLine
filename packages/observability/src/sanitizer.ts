const SENSITIVE_KEYS = new Set([
  'signature', 'signatures', 'payload', 'canonicalPayload',
  'payloadHash', 'body', 'text', 'html',
  'clientDataJSON', 'authenticatorData',
  'privateKey', 'secret', 'password', 'apiKey',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ROUTING_RE = /\b\d{9}\b/g;
const ACCOUNT_RE = /\b\d{8,17}\b/g;
const JWS_RE = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g;

export function sanitizeForLogging(input: unknown): unknown {
  return walk(input);
}

function walk(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return sanitizeString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(walk);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = walk(val);
      }
    }
    return out;
  }
  return v;
}

function sanitizeString(s: string): string {
  return s
    .replace(JWS_RE, '[REDACTED:JWT]')
    .replace(EMAIL_RE, '[REDACTED:EMAIL]')
    .replace(ROUTING_RE, '[REDACTED:ROUTING]')
    .replace(ACCOUNT_RE, '[REDACTED:ACCOUNT]');
}

export function beforeSendSentry(event: unknown, _hint: unknown): unknown {
  return sanitizeForLogging(event);
}
