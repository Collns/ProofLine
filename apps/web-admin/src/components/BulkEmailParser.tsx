import { useMemo } from 'react';
import { BULK_LIMIT } from '../api/invitations-client';

// Pragmatic email shape — same regex used server-side in fixture mode.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export interface ParsedBulkEmails {
  // Unique, valid emails preserving original casing for display, but
  // de-duplicated case-insensitively.
  valid: string[];
  // Token-by-token diagnostics for the preview UI.
  invalid: string[];
  duplicates: string[];
  // True when input would exceed BULK_LIMIT after dedupe.
  overLimit: boolean;
}

/**
 * Parse a paste-of-emails. Accepts one-per-line, comma-separated,
 * semicolon-separated, or any whitespace mix. De-duplicates
 * case-insensitively, validates with EMAIL_RE, caps at BULK_LIMIT.
 *
 * Pure function — exported for unit testing without DOM.
 */
export function parseBulkEmails(input: string): ParsedBulkEmails {
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!EMAIL_RE.test(token)) {
      invalid.push(token);
      continue;
    }
    const lower = token.toLowerCase();
    if (seen.has(lower)) {
      duplicates.push(token);
      continue;
    }
    seen.add(lower);
    valid.push(token);
  }

  const overLimit = valid.length > BULK_LIMIT;
  return {
    valid:      overLimit ? valid.slice(0, BULK_LIMIT) : valid,
    invalid,
    duplicates,
    overLimit,
  };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  // Domains the user already invited (passed in by the parent so the
  // preview can warn about repeats without coupling to API state here).
  alreadyInvitedLowerCase?: Set<string>;
  selfDomainLowerCase?: string;
  disabled?: boolean;
}

export function BulkEmailParser({
  value,
  onChange,
  alreadyInvitedLowerCase,
  selfDomainLowerCase,
  disabled,
}: Props) {
  const parsed = useMemo(() => parseBulkEmails(value), [value]);

  const repeats = useMemo(() => {
    if (!alreadyInvitedLowerCase) return [];
    return parsed.valid.filter((e) =>
      alreadyInvitedLowerCase.has(e.toLowerCase()),
    );
  }, [parsed.valid, alreadyInvitedLowerCase]);

  const selfDomainHits = useMemo(() => {
    if (!selfDomainLowerCase) return [];
    return parsed.valid.filter((e) =>
      e.toLowerCase().endsWith(`@${selfDomainLowerCase}`),
    );
  }, [parsed.valid, selfDomainLowerCase]);

  const sendableCount =
    parsed.valid.length - repeats.length - selfDomainHits.length;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[#0B1F3A]" htmlFor="bulk-emails">
        Paste up to {BULK_LIMIT} emails
        <span className="ml-1 font-normal text-gray-500">
          (one per line, or comma-separated)
        </span>
      </label>
      <textarea
        id="bulk-emails"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        spellCheck={false}
        className={[
          'block w-full rounded-md border border-gray-200 bg-white px-3 py-2.5',
          'text-sm text-[#1F2937] placeholder:text-gray-400 font-mono',
          'shadow-sm transition-colors duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:border-[#0D6EFD]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        ].join(' ')}
        placeholder={
          'wires@scotiabank.com\nclosings@titlepro-escrow.com\nops@horizon-title.com'
        }
      />
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
        <PreviewLine
          ok={parsed.valid.length > 0}
          text={
            parsed.valid.length === 0
              ? 'No valid emails detected yet.'
              : `${sendableCount} ready to send · ${parsed.valid.length} parsed valid`
          }
        />
        {parsed.duplicates.length > 0 && (
          <PreviewLine
            warn
            text={`${parsed.duplicates.length} duplicate${plural(parsed.duplicates.length)} removed`}
          />
        )}
        {parsed.invalid.length > 0 && (
          <PreviewLine
            warn
            text={`${parsed.invalid.length} invalid email${plural(parsed.invalid.length)} ignored`}
          />
        )}
        {repeats.length > 0 && (
          <PreviewLine
            warn
            text={`${repeats.length} already invited recently`}
          />
        )}
        {selfDomainHits.length > 0 && (
          <PreviewLine
            warn
            text={`${selfDomainHits.length} on your own domain — skipped`}
          />
        )}
        {parsed.overLimit && (
          <PreviewLine
            err
            text={`Capped at ${BULK_LIMIT}; the rest were dropped`}
          />
        )}
      </div>
    </div>
  );
}

function PreviewLine({
  ok,
  warn,
  err,
  text,
}: {
  ok?: boolean;
  warn?: boolean;
  err?: boolean;
  text: string;
}) {
  const tone = err
    ? 'text-[#D93025]'
    : warn
      ? 'text-[#B45309]'
      : ok
        ? 'text-[#0F9D58]'
        : 'text-gray-500';
  const icon = err ? '✕' : warn ? '!' : ok ? '✓' : '·';
  return (
    <p className={`flex items-baseline gap-2 ${tone}`}>
      <span aria-hidden="true" className="font-semibold">{icon}</span>
      <span>{text}</span>
    </p>
  );
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}
