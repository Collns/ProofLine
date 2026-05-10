import * as crypto from 'node:crypto';
import type { CryptoProvider, KeyHandle, Signature } from '../types.js';
import { verifyEcdsaP256 } from '../verify.js';
import { sha256 } from '../hash.js';
import { randomBytes } from '../random.js';

export function makeStubCryptoProvider(): CryptoProvider & {
  generateKeyPair(): { handle: KeyHandle; publicKey: string };
} {
  const keys = new Map<string, crypto.KeyObject>();

  return {
    generateKeyPair() {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
      });
      const credentialId = crypto.randomBytes(16).toString('hex');
      keys.set(credentialId, privateKey);
      const spki = publicKey.export({ type: 'spki', format: 'der' });
      return {
        handle: { kind: 'webauthn', credentialId },
        publicKey: (spki as Buffer).toString('base64'),
      };
    },
    async sign(handle: KeyHandle, message: Uint8Array): Promise<Signature> {
      if (handle.kind !== 'webauthn') throw new Error('stub only supports webauthn handles');
      const key = keys.get(handle.credentialId);
      if (!key) throw new Error('unknown credentialId');
      const signer = crypto.createSign('SHA256');
      signer.update(message);
      signer.end();
      return signer.sign({ key, dsaEncoding: 'der' }).toString('base64url');
    },
    async verify(publicKey: string, message: Uint8Array, sig: string): Promise<boolean> {
      return verifyEcdsaP256(publicKey, message, sig);
    },
    hash: sha256,
    randomBytes,
  };
}
