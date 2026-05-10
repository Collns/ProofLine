import * as crypto from 'node:crypto';

export function randomBytes(length: number): Uint8Array {
  return new Uint8Array(crypto.randomBytes(length));
}
