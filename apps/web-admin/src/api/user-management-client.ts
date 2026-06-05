// PFL-128: thin client for the user-management mutations.
//
// Three POST endpoints — invite, update role, update status — all
// authenticated by the signed-in Firebase user's ID token (Bearer).
// Mirrors the auth-header pattern in invitations-client.ts.

import { getFirebaseAuth } from '../lib/firebase';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Carries the server-side title + detail so the UI can show the
 * specific failure (e.g. EMPLOYEE_INVITATION_PENDING, SELF_CHANGE) and
 * the human-friendly detail in one banner.
 */
export class UserManagementError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'UserManagementError';
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

function apiBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env;
  return env?.VITE_API_BASE
    ? env.VITE_API_BASE.replace(/\/$/, '')
    : 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
}

async function bearerToken(): Promise<string | null> {
  try {
    const current = getFirebaseAuth().currentUser;
    if (current) {
      const token = await current.getIdToken();
      if (token) return token;
    }
  } catch {
    /* auth not configured — fall through to cache */
  }
  if (typeof window === 'undefined') return null;
  const cached = window.localStorage.getItem('firebase-id-token');
  return cached && cached.length > 0 ? cached : null;
}

async function adminPost<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const token = await bearerToken();
  if (!token) {
    throw new UserManagementError('NO_AUTH_TOKEN', 0, 'Not signed in');
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code   = `HTTP_${res.status}`;
    let detail = `Request failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { title?: string; detail?: string };
      if (errBody?.title)  code   = errBody.title;
      if (errBody?.detail) detail = errBody.detail;
    } catch { /* non-JSON body */ }
    throw new UserManagementError(code, res.status, detail);
  }
  return (await res.json()) as TRes;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface InviteEmployeeResponse {
  ok:           true;
  invitationId: string;
  email:        string;
  companyId:    string;
  role:         'employee' | 'manager';
  expiresAt:    number;
}

export function inviteEmployee(
  email: string,
  role: 'employee' | 'manager',
): Promise<InviteEmployeeResponse> {
  return adminPost<{ email: string; role: 'employee' | 'manager' }, InviteEmployeeResponse>(
    '/v1/admin/invite-employee',
    { email, role },
  );
}

export interface UpdateUserRoleResponse {
  ok:        true;
  userId:    string;
  role:      'employee' | 'manager';
  companyId: string;
}

export function updateUserRole(
  userId: string,
  role: 'employee' | 'manager',
): Promise<UpdateUserRoleResponse> {
  return adminPost<{ userId: string; role: 'employee' | 'manager' }, UpdateUserRoleResponse>(
    '/v1/admin/update-role',
    { userId, role },
  );
}

export interface UpdateUserStatusResponse {
  ok:              true;
  userId:          string;
  status:          'active' | 'inactive';
  sessionsRevoked: number;
  devicesRevoked:  number;
}

export function updateUserStatus(
  userId: string,
  status: 'active' | 'inactive',
): Promise<UpdateUserStatusResponse> {
  return adminPost<{ userId: string; status: 'active' | 'inactive' }, UpdateUserStatusResponse>(
    '/v1/admin/update-status',
    { userId, status },
  );
}
