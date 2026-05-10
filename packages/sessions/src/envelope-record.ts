export interface EnvelopeRecord {
  sessionId: string;
  userId: string;
  companyId: string;
  credentialId: string;
  canonicalPayloadHash: string;
  signature: string;
  signedAt: number;
  recipientAddresses: string[];
}
