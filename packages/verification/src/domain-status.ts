import type { RegistryView } from './types.js';

export interface DomainStatusInput {
  senderDomain: string;
  hasEnvelope: boolean;
}

export type DomainStatusResult =
  | { state: 'unknown_sender' }
  | { state: 'has_envelope' }
  | {
      state: 'suspected_spoof';
      company: { name: string; domain: string };
    };

// Empty/whitespace senderDomain → 'unknown_sender' (treated the same as
// "not on ProofLine"). Caller is responsible for upstream validation if
// it wants stricter input handling.
export async function resolveDomainStatus(
  input: DomainStatusInput,
  view: RegistryView,
): Promise<DomainStatusResult> {
  const normalized = input.senderDomain.trim().toLowerCase();
  if (!normalized) {
    return { state: 'unknown_sender' };
  }

  const company = await view.getCompanyByDomain(normalized);
  if (!company) {
    return { state: 'unknown_sender' };
  }

  if (input.hasEnvelope) {
    return { state: 'has_envelope' };
  }

  return {
    state: 'suspected_spoof',
    company: { name: company.legalName, domain: company.domain },
  };
}
