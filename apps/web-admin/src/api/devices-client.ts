// PFL-085: thin client for the device management endpoints.
//
// The dashboard reads device records from Firestore directly (admin-data.ts),
// but writes (revoke) MUST go through the Functions backend so the server
// can enforce auth + cascade session revocations.

export interface RevokeDeviceRequest {
  userId:       string;
  credentialId: string;
}

export interface RevokeDeviceResponse {
  ok:              true;
  userId:          string;
  credentialId:    string;
  revokedAt:       number;
  sessionsRevoked: number;
}

// The revoke endpoint lives on the `api` function alongside the other
// extension routes. Mirror the API_BASE convention from client.ts but
// strip the `/v1/onboard` suffix.
function apiBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env;
  return env?.VITE_API_BASE
    ? env.VITE_API_BASE.replace(/\/$/, '')
    : 'https://us-central1-proofline-cdabb.cloudfunctions.net/api';
}

/**
 * Call POST /v1/admin/revoke-device with the caller's extension auth
 * Bearer. The dashboard obtains this Bearer the same way the sign popup
 * does — via /v1/extension/auth — so admin sessions in the same browser
 * profile naturally have it.
 */
export async function revokeDevice(
  body: RevokeDeviceRequest,
  bearer: string,
): Promise<RevokeDeviceResponse> {
  const res = await fetch(`${apiBase()}/v1/admin/revoke-device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      Authorization:  `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { title?: string; detail?: string };
      if (errBody?.detail) detail = errBody.detail;
      else if (errBody?.title) detail = errBody.title;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`revoke-device failed: ${detail}`);
  }

  return (await res.json()) as RevokeDeviceResponse;
}
