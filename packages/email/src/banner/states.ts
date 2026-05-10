export type BannerState = 'verified' | 'bilateral' | 'suspected_spoof';

export interface BannerStateConfig {
  borderColor: string;
  bgColor: string;
  textColor: string;
  iconChar: string;
  headline: string;
  bodyTemplate: string;
}

export const STATE_CONFIG: Record<BannerState, BannerStateConfig> = {
  verified: {
    borderColor: '#0F9D58',
    bgColor: '#F0FAF4',
    textColor: '#0B1F3A',
    iconChar: '✓',
    headline: 'Verified by ProofLine',
    bodyTemplate: 'Signed by {signerName} at {companyName}.',
  },
  bilateral: {
    borderColor: '#047857',
    bgColor: '#ECFDF5',
    textColor: '#0B1F3A',
    iconChar: '✓✓',
    headline: 'Bilateral signature',
    bodyTemplate:
      'Both {companyName} and the counterparty signed the same canonical bytes.',
  },
  suspected_spoof: {
    borderColor: '#D93025',
    bgColor: '#FEF2F2',
    textColor: '#7F1D1D',
    iconChar: '⚠',
    headline: 'Suspected spoof',
    bodyTemplate:
      'This domain is on ProofLine but this message was not signed. Treat as spoof.',
  },
};
