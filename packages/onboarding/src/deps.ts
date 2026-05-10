import type { KYBProvider } from '@proofline/kyb';
import type { EmailProvider } from '@proofline/email';
import type { CryptoProvider } from '@proofline/crypto';
import type { AnchorProvider } from '@proofline/anchoring';
import type {
  OnboardingStore,
  DNSResolver,
  KmsKeyProvisioner,
} from './types.js';

export interface OnboardingDeps {
  store: OnboardingStore;
  kyb: KYBProvider;
  email: EmailProvider;
  crypto: CryptoProvider;
  anchor: AnchorProvider;
  kmsProvisioner: KmsKeyProvisioner;
  dns: DNSResolver;
  now: () => number;
  uuid?: () => string;
  randomCode?: () => string;
}
