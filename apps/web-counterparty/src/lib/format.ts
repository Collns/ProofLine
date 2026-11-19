/**
 * Currency, account, and date formatting — mirrors apps/web-verify/src/lib/format.ts
 * deliberately so the visual surface stays consistent.
 */

/**
 * Formats a wire amount. WirePayload.amount is whole US dollars (see
 * web-verify), so there is no cents conversion.
 */
export function formatWireAmount(dollars: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatAccountMasked(input: string): string {
  // Already masked? leave alone.
  if (/^[•X]{2,}/.test(input) || input.includes('••••')) return input;
  const last4 = input.slice(-4);
  return `••••${last4}`;
}

export function formatRouting(routing: string): string {
  if (routing.length !== 9) return routing;
  return `${routing.slice(0, 3)} ${routing.slice(3, 6)} ${routing.slice(6, 9)}`;
}

export function formatTimeAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (deltaSec < 60)            return 'just now';
  if (deltaSec < 60 * 60)       return `${Math.floor(deltaSec / 60)} minute${deltaSec >= 120 ? 's' : ''} ago`;
  if (deltaSec < 60 * 60 * 24)  return `${Math.floor(deltaSec / 3600)} hour${deltaSec >= 7200 ? 's' : ''} ago`;
  return `${Math.floor(deltaSec / 86400)} day${deltaSec >= 172800 ? 's' : ''} ago`;
}
