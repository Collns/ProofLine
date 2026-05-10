import * as crypto from 'node:crypto';

/**
 * Verify an ECDSA P-256 signature using only built-in crypto.
 * publicKey: SPKI base64
 * message: raw bytes to verify
 * signature: base64url DER
 */
export async function verifyEcdsaP256(
  publicKey: string,
  message: Uint8Array,
  signature: string,
): Promise<boolean> {
  try {
    const pubKey = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const sigBytes = Buffer.from(signature, 'base64url');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(message);
    verifier.end();
    return verifier.verify({ key: pubKey, dsaEncoding: 'der' }, sigBytes);
  } catch {
    return false;
  }
}
