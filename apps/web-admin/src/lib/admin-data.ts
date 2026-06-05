// PFL-127: server-side admin API client. Replaces the client-direct
// Firestore reads that PFL-111 introduced (kept below as
// fetch*_legacy fallbacks while the server endpoints roll out).
//
// Auth: every call passes the signed-in Firebase user's ID token as a
// Bearer. The server middleware (apps/functions/src/auth/admin-auth.middleware.ts)
// verifies the token, looks up users/{uid}, enforces owner|manager +
// active + non-empty companyId, then scopes the response to that
// company. The legacy fns below DO NOT enforce any of that — they
// only exist as an emergency offline fallback.
//
// Defensive style is unchanged: any failure (no token, 401, 403, 500,
// network) resolves to a safe empty default so the dashboard always
// renders. We log to console.warn so the operator can grep prod logs
// without surfacing a scary error screen.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase';

// ─── Response types (mirrors apps/functions/src/api/admin/handlers.ts) ──────

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
  // PFL-127 extras surfaced by the server response.
  ein: string | null;
  onboardingStatus: string | null;
  kmsKeyName: string | null;
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
  createdAt: number | null;
}

export interface AdminSignature {
  signerId: string;
  credentialId: string;
  signedAt: number | null;
}

export interface AdminSignedMessage {
  id: string;
  subject: string;
  from: string;
  to: string[];
  signedAt: number | null;
  anchored: boolean;
  anchorBlockNumber: number | null;
  // PFL-127 extras.
  isWireInstruction: boolean;
  status: string;
  anchorTxHash: string | null;
  signatures: AdminSignature[];
}

export interface AdminSession {
  id: string;
  userId: string;
  recipient: string;
  authorizedAt: number | null;
  expiresAt: number | null;
  // PFL-127 extras.
  deviceCredentialId: string;
  recipientScope: string;
  lastUsedAt: number | null;
  signCount: number | null;
}

export interface AdminInvitation {
  invitationId: string;
  email: string;
  role: string;
  status: string;
  invitedBy: string;
  createdAt: number | null;
  expiresAt: number | null;
  acceptedAt: number | null;
}

// ─── Coercion helpers (kept here so legacy fns keep using them) ─────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// ─── Server-side admin API client ────────────────────────────────────────────

function apiBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env;
  return env?.VITE_API_BASE
    ? env.VITE_API_BASE.replace(/\/$/, '')
    : 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
}

/**
 * Build the Bearer header from the signed-in Firebase user. We try the
 * live Auth `currentUser` first (always-fresh token), then fall back to
 * the cached id-token AuthContext writes to localStorage. Returns null
 * when neither path produces a token — caller must skip the request.
 */
async function bearerToken(): Promise<string | null> {
  try {
    const current = getFirebaseAuth().currentUser;
    if (current) {
      const token = await current.getIdToken();
      if (token) return token;
    }
  } catch {
    /* auth not configured or offline — fall through to cache */
  }
  if (typeof window === 'undefined') return null;
  const cached = window.localStorage.getItem('firebase-id-token');
  return cached && cached.length > 0 ? cached : null;
}

/**
 * Generic GET helper. Appends ?cid=<override> when the caller supplies
 * one — the server enforces owner-only access to that path.
 */
async function adminGet<T>(path: string, cidOverride?: string): Promise<T | null> {
  const token = await bearerToken();
  if (!token) {
    console.warn(`[admin-data] ${path}: no Firebase ID token available`);
    return null;
  }
  const url = new URL(`${apiBase()}${path}`);
  if (cidOverride && cidOverride.trim().length > 0) {
    url.searchParams.set('cid', cidOverride.trim());
  }
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string; title?: string };
        detail = body?.detail ?? body?.title ?? detail;
      } catch { /* non-JSON */ }
      console.warn(`[admin-data] ${path} failed: ${detail}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[admin-data] ${path} network failure`, err);
    return null;
  }
}

// PFL-127 admin API: each fetch* signature takes an optional cidOverride
// (the dashboard's ?cid= URL param) — the server then validates
// ownership before honouring it. Legacy callers that pass the cid by
// position keep working since the param is positional.

export async function fetchCompanyProfile(cidOverride?: string): Promise<CompanyProfile | null> {
  const body = await adminGet<CompanyProfile>('/v1/admin/company', cidOverride);
  if (!body) return null;
  return {
    companyId:        str(body.companyId),
    legalName:        str(body.legalName, '(unnamed company)'),
    domain:           str(body.domain),
    status:           str(body.status, 'unknown'),
    createdAt:        body.createdAt,
    verifiedAt:       body.verifiedAt,
    rootPublicKey:    body.rootPublicKey,
    anchorTxHash:     body.anchorTxHash,
    anchorBlockNumber: body.anchorBlockNumber,
    ein:              body.ein,
    onboardingStatus: body.onboardingStatus,
    kmsKeyName:       body.kmsKeyName,
  };
}

export async function fetchUsers(cidOverride?: string): Promise<AdminUser[]> {
  const body = await adminGet<{ users: AdminUser[] }>('/v1/admin/users', cidOverride);
  return body?.users ?? [];
}

export async function fetchRecentSignedMessages(
  cidOverride?: string,
  _max = 10,                  // accepted for back-compat; server caps at 50
): Promise<AdminSignedMessage[]> {
  void _max;
  const body = await adminGet<{
    messages: Array<{
      messageId: string;
      from: string;
      to: string[];
      subject: string;
      isWireInstruction: boolean;
      status: string;
      createdAt: number | null;
      anchorTxHash: string | null;
      anchorBlockNumber: number | null;
      signatures: AdminSignature[];
    }>;
  }>('/v1/admin/signed-messages', cidOverride);
  if (!body) return [];
  return body.messages.map((m) => ({
    id:                m.messageId,
    subject:           m.subject,
    from:              m.from,
    to:                m.to,
    signedAt:          m.signatures[0]?.signedAt ?? m.createdAt,
    anchored:          m.anchorBlockNumber !== null && m.anchorBlockNumber > 0,
    anchorBlockNumber: m.anchorBlockNumber,
    isWireInstruction: m.isWireInstruction,
    status:            m.status,
    anchorTxHash:      m.anchorTxHash,
    signatures:        m.signatures,
  }));
}

export async function fetchActiveSessions(cidOverride?: string): Promise<AdminSession[]> {
  const body = await adminGet<{
    sessions: Array<{
      sessionId: string;
      userId: string;
      recipientScope: string;
      primaryRecipient: string;
      deviceCredentialId: string;
      authorizedAt: number | null;
      expiresAt: number | null;
      lastUsedAt: number | null;
      signCount: number | null;
    }>;
  }>('/v1/admin/sessions', cidOverride);
  if (!body) return [];
  return body.sessions.map((s) => ({
    id:                 s.sessionId,
    userId:             s.userId,
    recipient:          s.primaryRecipient || s.recipientScope || '—',
    authorizedAt:       s.authorizedAt,
    expiresAt:          s.expiresAt,
    deviceCredentialId: s.deviceCredentialId,
    recipientScope:     s.recipientScope,
    lastUsedAt:         s.lastUsedAt,
    signCount:          s.signCount,
  }));
}

/** PFL-127 new: invitation list for the admin dashboard. */
export async function fetchInvitations(cidOverride?: string): Promise<AdminInvitation[]> {
  const body = await adminGet<{ invitations: AdminInvitation[] }>('/v1/admin/invitations', cidOverride);
  return body?.invitations ?? [];
}

// ─── Legacy: client-direct Firestore reads (kept as emergency fallback) ─────
//
// These were the PFL-111 implementation. They read Firestore directly
// from the browser, which means rules permit it. Today (PFL-122) the
// rules deny most of these collections to clients, so these fns will
// return empty unless the rules are temporarily relaxed. Use only if
// the server API is unavailable.

export async function fetchCompanyProfile_legacy(cid: string): Promise<CompanyProfile | null> {
  if (!cid) return null;
  try {
    const snap = await getDoc(doc(getDb(), 'companies', cid));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      companyId: cid,
      legalName: str(d.legalName, '(unnamed company)'),
      domain: str(d.domain),
      status: str(d.status) || str(d.onboardingStatus, 'unknown'),
      createdAt: num(d.createdAt),
      verifiedAt: num(d.verifiedAt),
      rootPublicKey: typeof d.rootPublicKey === 'string' ? d.rootPublicKey : null,
      anchorTxHash: typeof d.anchorTxHash === 'string' && d.anchorTxHash ? d.anchorTxHash : null,
      anchorBlockNumber: num(d.anchorBlockNumber),
      ein:              typeof d.ein === 'string' ? d.ein : null,
      onboardingStatus: typeof d.onboardingStatus === 'string' ? d.onboardingStatus : null,
      kmsKeyName:       typeof d.kmsKeyName === 'string' ? d.kmsKeyName : null,
    };
  } catch (err) {
    console.warn('[admin-data] fetchCompanyProfile_legacy failed', err);
    return null;
  }
}

export async function fetchUsers_legacy(cid: string): Promise<AdminUser[]> {
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
        createdAt: num(d.createdAt),
      };
    });
  } catch (err) {
    console.warn('[admin-data] fetchUsers_legacy failed', err);
    return [];
  }
}

export async function fetchRecentSignedMessages_legacy(
  cid: string,
  max = 10,
): Promise<AdminSignedMessage[]> {
  try {
    const q = query(
      collection(getDb(), 'signed_messages'),
      orderBy('createdAt', 'desc'),
      fbLimit(Math.max(max * 3, 25)),
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
        isWireInstruction: payload.isWireInstruction === true,
        status: str(d.status, 'SIGNED'),
        anchorTxHash: typeof d.anchorTxHash === 'string' && d.anchorTxHash ? d.anchorTxHash : null,
        signatures: signatures.map((s) => ({
          signerId:     str((s as Record<string, unknown>).signerId),
          credentialId: str((s as Record<string, unknown>).credentialId),
          signedAt:     num((s as Record<string, unknown>).signedAt),
        })),
      });
      if (out.length >= max) break;
    }
    return out;
  } catch (err) {
    console.warn('[admin-data] fetchRecentSignedMessages_legacy failed', err);
    return [];
  }
}

export async function fetchActiveSessions_legacy(cid: string): Promise<AdminSession[]> {
  try {
    const q = query(collection(getDb(), 'sessions'), fbLimit(50));
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
        deviceCredentialId: str(d.deviceCredentialId),
        recipientScope:     str(d.recipientSetHash),
        lastUsedAt:         num(d.lastUsedAt),
        signCount:          num(d.signCount),
      });
    }
    return out;
  } catch (err) {
    console.warn('[admin-data] fetchActiveSessions_legacy failed', err);
    return [];
  }
}
