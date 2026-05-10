import { createHash } from 'node:crypto';

export function recipientSetHash(toAddresses: string[]): string {
  if (toAddresses.length === 0) {
    throw new Error('recipientSetHash: empty toAddresses');
  }
  const normalized = toAddresses
    .map((a) => a.trim().toLowerCase())
    .sort();
  const json = JSON.stringify(normalized);
  return createHash('sha256').update(json).digest('hex');
}
