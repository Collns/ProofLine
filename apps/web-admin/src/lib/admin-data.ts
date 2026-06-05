// PFL-111: client-side Firestore reads for the admin dashboard.
//
// Every function is defensive: any failure (missing config, closed
// security rules, missing index, network) resolves to a safe empty
// default so the dashboard always renders. Field access is optional-
// chained because the stored docs predate strict schemas.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';

export interface CompanyProfile {
  companyId: string;
  legalName: string;
  domain: string;
  status: string;          // verified / pending_* / etc.
  createdAt: number | null;
  verifiedAt: number | null;
  rootPublicKey: string | null;
  anchorTxHash: string | null;
  anchorBlockNumber: number | null;
}

export interface AdminDevice {
  credentialId: string;
  enrolledAt: number | null;
  // PFL-085 multi-device fields. All optional — older device records
  // predate them.
  deviceName: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface AdminUser {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  devices: AdminDevice[];
}

export interface AdminSignedMessage {
  id: string;
  subject: string;
  from: string;
  to: string[];
  signedAt: number | null;
  anchored: boolean;
  anchorBlockNumber: number | null;
}

export interface AdminSession {
  id: string;
  userId: string;
  recipient: string;
  authorizedAt: number | null;
  expiresAt: number | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export async function fetchCompanyProfile(cid: string): Promise<CompanyProfile | null> {
  if (!cid) return null;
  try {
    const snap = await getDoc(doc(getDb(), 'companies', cid));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      companyId: cid,
      legalName: str(d.legalName, '(unnamed company)'),
      domain: str(d.domain),
      // Prefer the verification-enum `status`; fall back to onboardingStatus.
      status: str(d.status) || str(d.onboardingStatus, 'unknown'),
      createdAt: num(d.createdAt),
      verifiedAt: num(d.verifiedAt),
      rootPublicKey: typeof d.rootPublicKey === 'string' ? d.rootPublicKey : null,
      anchorTxHash: typeof d.anchorTxHash === 'string' && d.anchorTxHash ? d.anchorTxHash : null,
      anchorBlockNumber: num(d.anchorBlockNumber),
    };
  } catch (err) {
    console.warn('[admin-data] fetchCompanyProfile failed', err);
    return null;
  }
}

export async function fetchUsers(cid: string): Promise<AdminUser[]> {
  if (!cid) return [];
  try {
    const q = query(collection(getDb(), 'users'), where('companyId', '==', cid));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      const rawDevices = Array.isArray(d.devices) ? (d.devices as Record<string, unknown>[]) : [];
      return {
        userId: docSnap.id,
        displayName: str(d.displayName) || docSnap.id,
        email: str(d.email),
        role: str(d.role, 'unknown'),
        status: str(d.status, 'unknown'),
        devices: rawDevices.map((dev) => ({
          credentialId: str(dev.credentialId),
          enrolledAt:   num(dev.enrolledAt),
          deviceName:   typeof dev.deviceName === 'string' && dev.deviceName ? dev.deviceName : null,
          lastUsedAt:   num(dev.lastUsedAt),
          revokedAt:    num(dev.revokedAt),
        })),
      };
    });
  } catch (err) {
    console.warn('[admin-data] fetchUsers failed', err);
    return [];
  }
}

export async function fetchRecentSignedMessages(
  cid: string,
  max = 10,
): Promise<AdminSignedMessage[]> {
  try {
    // Order by createdAt only (single-field index is automatic). Filter by
    // company client-side to avoid requiring a composite index.
    const q = query(
      collection(getDb(), 'signed_messages'),
      orderBy('createdAt', 'desc'),
      limit(Math.max(max * 3, 25)),
    );
    const snap = await getDocs(q);
    const out: AdminSignedMessage[] = [];
    for (const docSnap of snap.docs) {
      const d = docSnap.data() as Record<string, unknown>;
      const payload = (d.payload ?? {}) as Record<string, unknown>;
      if (cid && str(payload.companyId) && str(payload.companyId) !== cid) continue;
      const signatures = Array.isArray(d.signatures) ? (d.signatures as Record<string, unknown>[]) : [];
      const firstSig = signatures[0] ?? {};
      const blockNumber = num(d.anchorBlockNumber);
      out.push({
        id: docSnap.id,
        subject: str(payload.subject) || '(no subject)',
        from: str(payload.from),
        to: Array.isArray(payload.to) ? (payload.to as unknown[]).map((t) => String(t)) : [],
        signedAt: num(firstSig.signedAt) ?? num(d.createdAt),
        anchored: blockNumber !== null && blockNumber > 0,
        anchorBlockNumber: blockNumber,
      });
      if (out.length >= max) break;
    }
    return out;
  } catch (err) {
    console.warn('[admin-data] fetchRecentSignedMessages failed', err);
    return [];
  }
}

export async function fetchActiveSessions(cid: string): Promise<AdminSession[]> {
  try {
    // Defensive: session doc shape varies; fetch a bounded set and filter
    // client-side for active + company match. Tolerates missing fields.
    const q = query(collection(getDb(), 'sessions'), limit(50));
    const snap = await getDocs(q);
    const out: AdminSession[] = [];
    for (const docSnap of snap.docs) {
      const d = docSnap.data() as Record<string, unknown>;
      const status = str(d.status, 'active');
      if (status !== 'active') continue;
      if (cid && str(d.companyId) && str(d.companyId) !== cid) continue;
      out.push({
        id: docSnap.id,
        userId: str(d.userId) || str(d.signerId) || '—',
        recipient: str(d.recipient) || str(d.recipientSetHash) || '—',
        authorizedAt: num(d.authorizedAt) ?? num(d.createdAt) ?? num(d.storedAt),
        expiresAt: num(d.expiresAt) ?? num(d.hardCapAt),
      });
    }
    return out;
  } catch (err) {
    console.warn('[admin-data] fetchActiveSessions failed', err);
    return [];
  }
}
