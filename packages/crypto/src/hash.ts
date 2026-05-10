import * as crypto from 'node:crypto';

export function sha256(input: Uint8Array): Uint8Array {
  return new Uint8Array(crypto.createHash('sha256').update(input).digest());
}
