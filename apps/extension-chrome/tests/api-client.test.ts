import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installChromeMock, type ChromeMock } from "./helpers/chrome-mock.js";

let chromeMock: ChromeMock;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  chromeMock = installChromeMock();
  fetchMock  = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  chromeMock.uninstall();
});

async function importApi() {
  vi.resetModules();
  return await import("../src/background/api-client.js");
}

async function seedAuthToken(token = "tok") {
  vi.resetModules();
  const store = await import("../src/background/session-store.js");
  await store.setAuthToken({
    token,
    userId:       "u",
    companyId:    "c",
    email:        "u@example.com",
    extInstallId: "e",
    iat:          Math.floor(Date.now() / 1000),
    exp:          Math.floor(Date.now() / 1000) + 3600,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok:    status >= 200 && status < 300,
    status,
    json:  async () => body,
  } as unknown as Response;
}

const FAKE_ASSERTION = {
  credentialId:      "cred",
  clientDataJSON:    "abc",
  authenticatorData: "def",
  signature:         "ghi",
};

const FAKE_PAYLOAD = {
  v:        1,
  to:       ["alice@example.com"],
  cc:       [],
  bcc:      [],
  subject:  "Test",
  body:     "Hello",
  isWireInstruction: false,
  issuedAt:  1700000000,
  expiresAt: 1700086400,
  nonce:     "nonce-1",
  from:      "user@example.com",
  companyId: "co_1",
} as const;

describe("api-client", () => {
  it("callSignFresh POSTs the spec'd body shape with bearer auth header", async () => {
    await seedAuthToken("tok-fresh");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok:             true,
        challenge:      { challenge: "ch_1" },
        policyDecision: "APPROVED",
      }),
    );
    const api = await importApi();
    const result = await api.callSignFresh({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload:          FAKE_PAYLOAD as any,
      recipientSetHash: "rs_1",
      credentialId:     "cred",
    });

    expect(result).toMatchObject({ ok: true, policyDecision: "APPROVED" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/sign");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      payload:          FAKE_PAYLOAD,
      recipientSetHash: "rs_1",
      credentialId:     "cred",
      freshBiometric:   true,
    });
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer tok-fresh");
  });

  it("callSignSilent includes sessionToken in the body", async () => {
    await seedAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, challenge: { challenge: "ch_2" } }),
    );
    const api = await importApi();
    await api.callSignSilent({
      sessionToken:     "sess_jws",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload:          FAKE_PAYLOAD as any,
      recipientSetHash: "rs",
      credentialId:     "cred",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/sign-silent");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sessionToken).toBe("sess_jws");
    expect(body.recipientSetHash).toBe("rs");
  });

  it("callSignFinalize sets X-Proofline-Challenge-Id and forwards path/sessionToken", async () => {
    await seedAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok:           true,
        envelope:     { v: 1 },
        banner:       "<table></table>",
        sessionToken: "sess_new",
      }),
    );
    const api = await importApi();
    await api.callSignFinalize({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertion:        FAKE_ASSERTION as any,
      payloadHash:      "ph",
      recipientSetHash: "rs",
      path:             "silent",
      sessionToken:     "sess_jws",
      challengeId:      "ch_42",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/sign/finalize");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Proofline-Challenge-Id"]).toBe("ch_42");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.path).toBe("silent");
    expect(body.sessionToken).toBe("sess_jws");
  });

  it("throws ApiError(AUTH_REQUIRED) when no auth token is stored", async () => {
    const api = await importApi();
    await expect(
      api.callSignFresh({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload:          FAKE_PAYLOAD as any,
        recipientSetHash: "rs",
        credentialId:     "c",
      }),
    ).rejects.toMatchObject({
      name:       "ApiError",
      code:       "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("surfaces server error bodies as ApiError with the embedded code", async () => {
    await seedAuthToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "POLICY_DENIED", message: "no" } },
        422,
      ),
    );
    const api = await importApi();
    await expect(
      api.callSignFresh({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload:          FAKE_PAYLOAD as any,
        recipientSetHash: "rs",
        credentialId:     "c",
      }),
    ).rejects.toMatchObject({
      name:       "ApiError",
      code:       "POLICY_DENIED",
      httpStatus: 422,
    });
  });
});
