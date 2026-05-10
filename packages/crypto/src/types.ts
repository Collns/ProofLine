export type Signature = string;       // base64url DER
export type PublicKey = string;       // SPKI base64

export type KeyHandle =
  | { kind: 'kms'; resourceName: string }
  | { kind: 'webauthn'; credentialId: string };

export interface CryptoProvider {
  sign(privateKey: KeyHandle, message: Uint8Array): Promise<Signature>;
  verify(publicKey: PublicKey, message: Uint8Array, sig: Signature): Promise<boolean>;
  hash(input: Uint8Array): Uint8Array;
  randomBytes(length: number): Uint8Array;
}
