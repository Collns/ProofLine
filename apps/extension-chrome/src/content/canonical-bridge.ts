// Wraps @proofline/canonical's canonicalize() with a SHA-256 hash that
// works in a Manifest v3 content script.
//
// Why not @proofline/crypto's sha256? That helper imports `node:crypto`,
// which esbuild can't bundle for the browser. The Web Crypto API
// (`crypto.subtle.digest`) is available in MV3 content scripts and
// produces the same SHA-256 digest, so we call it directly here.

import { canonicalize } from '@proofline/canonical';

export interface CanonicalResult {
  canonicalBytes: Uint8Array;
  payloadHashHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function canonicalizeAndHash(
  value: unknown,
): Promise<CanonicalResult> {
  const canonicalBytes = canonicalize(value);
  // crypto.subtle.digest expects an ArrayBuffer-backed BufferSource.
  // We slice into a fresh Uint8Array to guarantee that the underlying
  // buffer is exactly canonicalBytes.byteLength wide.
  const view = new Uint8Array(canonicalBytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  const payloadHashHex = bytesToHex(new Uint8Array(digest));
  return { canonicalBytes, payloadHashHex };
}
