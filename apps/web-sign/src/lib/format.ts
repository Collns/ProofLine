// Borrowed from apps/web-verify/src/lib/format.ts. Kept narrow to what
// the popup actually displays — no need to grow this file.

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export function formatUSD(cents: number): string {
  return USD_FORMATTER.format(cents / 100);
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function formatTimestamp(unixSeconds: number): string {
  return DATE_FORMATTER.format(new Date(unixSeconds * 1000));
}

export function formatRelativeMinutes(deltaMs: number): string {
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes === 0) return 'expires now';
  if (minutes === 1) return 'expires in 1 minute';
  return `expires in ${minutes} minutes`;
}

export function maskAccount(account: string): string {
  if (account.startsWith('•')) return account;
  if (account.length <= 4) return `••••${account}`;
  return `••••${account.slice(-4)}`;
}

export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}
