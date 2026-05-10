import {
  startRegistration as browserStartRegistration,
  startAuthentication as browserStartAuthentication,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

export class UserCancelled extends Error {
  constructor(message?: string) {
    super(message ?? 'User cancelled the WebAuthn ceremony');
    this.name = 'UserCancelled';
  }
}

export class DeviceUnsupported extends Error {
  constructor(message?: string) {
    super(message ?? 'This device does not support WebAuthn');
    this.name = 'DeviceUnsupported';
  }
}

export class WebAuthnAbortError extends Error {
  constructor(message?: string) {
    super(message ?? 'WebAuthn ceremony was aborted');
    this.name = 'WebAuthnAbortError';
  }
}

function mapCeremonyError(err: unknown): never {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError') throw new UserCancelled(err.message);
    if (err.name === 'NotSupportedError') throw new DeviceUnsupported(err.message);
    if (err.name === 'AbortError') throw new WebAuthnAbortError(err.message);
  }
  throw err;
}

export async function startRegistrationCeremony(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  try {
    return await browserStartRegistration(options);
  } catch (err) {
    mapCeremonyError(err);
  }
}

export async function startAssertionCeremony(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  try {
    return await browserStartAuthentication(options);
  } catch (err) {
    mapCeremonyError(err);
  }
}
