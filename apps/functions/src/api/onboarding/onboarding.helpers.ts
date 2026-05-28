/**
 * @file onboarding.helpers.ts
 * @module apps/functions/src/api/onboarding
 *
 * Firestore access and domain verification helpers for the onboarding pipeline.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { getFirestore } from "firebase-admin/firestore";

// ─── Company document schema ─────────────────────────────────────────────────

export type OnboardingStatus =
  | "pending_dns"
  | "pending_email"
  | "pending_kyb"
  | "pending_kyc"
  | "pending_finalize"
  | "verified"
  | "rejected";

export interface CompanyDoc {
  companyId: string;
  domain: string;
  legalName: string;
  ein: string;
  state: string;
  ownerUserId: string;
  ownerEmail: string;
  onboardingStatus: OnboardingStatus;
  // PFL-103: the VERIFY-side shapeCompany() reads `status` (the
  // verification enum), NOT `onboardingStatus`. Without this field a
  // finalized company resolves to null → COMPANY_UNKNOWN at verify time.
  // Set to 'verified' at finalize.
  status?: "verified" | "suspended" | "revoked";
  dnsToken: string;
  dnsVerifiedAt?: number;
  emailCode?: string;
  emailCodeExpiresAt?: number;
  emailVerifiedAt?: number;
  kybResult?: {
    ok: boolean;
    vendorRef: string;
    flags: string[];
    officers: { name: string; role: string }[];
    verifiedAt: number;
  };
  officerEnrollment?: {
    stripeSessionId: string;
    stripeClientSecret: string;
    officerEmail: string;
    verifiedAt?: number;
  };
  kmsKeyName?: string;
  rootPublicKey?: string;
  anchorTxHash?: string;
  anchorBlockNumber?: number;
  verifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

function db() {
  return getFirestore();
}

export async function getCompany(companyId: string): Promise<CompanyDoc | null> {
  const snap = await db().collection("companies").doc(companyId).get();
  return snap.exists ? (snap.data() as CompanyDoc) : null;
}

export async function getCompanyByDomain(domain: string): Promise<CompanyDoc | null> {
  const snap = await db()
    .collection("companies")
    .where("domain", "==", domain.toLowerCase().trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as CompanyDoc;
}

export async function updateCompany(
  companyId: string,
  patch: Partial<Omit<CompanyDoc, "companyId" | "createdAt">>
): Promise<void> {
  await db()
    .collection("companies")
    .doc(companyId)
    .update({ ...patch, updatedAt: Date.now() });
}

// ─── DNS verification ─────────────────────────────────────────────────────────

const DNS_RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];

async function resolveTxtVia(resolver: string, hostname: string): Promise<string[]> {
  const r = new dns.Resolver();
  r.setServers([resolver]);
  const records = await r.resolveTxt(hostname);
  return records.flat();
}

export async function verifyDnsTxtRecord(
  domain: string,
  token: string
): Promise<{ ok: boolean; detail: string }> {
  const hostname = `_proofline.${domain}`;
  const expected = `proofline-verify=${token}`;

  const results = await Promise.allSettled(
    DNS_RESOLVERS.map((r) => resolveTxtVia(r, hostname))
  );

  let matched = 0;
  const details: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const resolver = DNS_RESOLVERS[i];
    if (result.status === "fulfilled") {
      const found = result.value.some((v) => v.includes(expected));
      if (found) {
        matched++;
        details.push(`${resolver}: ✓`);
      } else {
        details.push(`${resolver}: record not found`);
      }
    } else {
      details.push(`${resolver}: ${(result.reason as any)?.message ?? "error"}`);
    }
  }

  return { ok: matched >= 2, detail: details.join("; ") };
}

// ─── Email OTP ────────────────────────────────────────────────────────────────

const OTP_TTL_MS = 10 * 60 * 1000;

export function generateEmailCode(): { code: string; codeHash: string; expiresAt: number } {
  const n = (randomBytes(3).readUIntBE(0, 3) % 900_000) + 100_000;
  const code = String(n);
  const codeHash = createHash("sha256").update(code).digest("hex");
  return { code, codeHash, expiresAt: Date.now() + OTP_TTL_MS };
}

export function verifyEmailCode(submitted: string, storedHash: string): boolean {
  const submittedHash = createHash("sha256").update(submitted.trim()).digest("hex");
  return submittedHash === storedHash;
}

// ─── DNS token generation ─────────────────────────────────────────────────────

export function generateDnsToken(): string {
  return randomBytes(20).toString("hex");
}