import { SignJWT, jwtVerify, errors, type CryptoKey, type JWTPayload } from 'jose';
import {
  SessionTokenPayload,
  type SessionError,
  type Result,
  ok,
  err,
} from './types.js';

export interface TokenSigner {
  sign(payload: SessionTokenPayload): Promise<string>;
}

export interface TokenVerifier {
  verify(token: string): Promise<Result<SessionTokenPayload, SessionError>>;
}

export interface JoseSignerOptions {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  algorithm?: string;
  issuer?: string;
}

export function makeJoseSigner(opts: JoseSignerOptions): TokenSigner {
  const alg = opts.algorithm ?? 'ES256';
  const iss = opts.issuer ?? 'proofline';
  return {
    async sign(payload) {
      return new SignJWT(payload as unknown as JWTPayload)
        .setProtectedHeader({ alg })
        .setIssuer(iss)
        .setIssuedAt(payload.iat)
        .setExpirationTime(payload.exp)
        .sign(opts.privateKey);
    },
  };
}

export function makeJoseVerifier(opts: JoseSignerOptions): TokenVerifier {
  const iss = opts.issuer ?? 'proofline';
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, opts.publicKey, {
          issuer: iss,
        });
        const parsed = SessionTokenPayload.safeParse(payload);
        if (!parsed.success) {
          return err({ code: 'TOKEN_MALFORMED' });
        }
        return ok(parsed.data);
      } catch (e: unknown) {
        if (e instanceof errors.JWTExpired) {
          return err({ code: 'TOKEN_EXPIRED' });
        }
        if (e instanceof errors.JWSSignatureVerificationFailed) {
          return err({ code: 'TOKEN_INVALID_SIG' });
        }
        return err({ code: 'TOKEN_MALFORMED' });
      }
    },
  };
}
