import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function defaultUuid(): string {
  return randomUUID();
}

export function defaultRandomCode(): string {
  // Cryptographic 6-digit numeric (0–999999) zero-padded
  const buf = randomBytes(4);
  const n = buf.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

export function dnsTokenFor(onboardingId: string): string {
  // Deterministic from onboardingId so calling start twice yields the same TXT record
  return createHash('sha256')
    .update(`proofline-dns:${onboardingId}`)
    .digest('hex')
    .slice(0, 32);
}

export function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
