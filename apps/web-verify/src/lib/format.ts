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

export function maskAccount(account: string): string {
  if (account.startsWith('•')) return account;
  if (account.length <= 4) return `••••${account}`;
  return `••••${account.slice(-4)}`;
}

export function truncateHash(hash: string, chars = 10): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}
