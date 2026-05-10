import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

import { makeApp } from "../../index.js";
import { makeStubFirestore } from "./firestore-stub.js";
import {
  plantScenario,
  makeEmailPayload,
  makeBilateralPayload,
  buildEnvelope,
  hashPayload,
  makeChainReader,
  ANCHOR_ROOT,
} from "./envelope-helpers.js";

function buildApp(scenario: ReturnType<typeof plantScenario>) {
  return makeApp({
    firestore: makeStubFirestore(scenario.store),
    chainReader: makeChainReader(),
  });
}

describe("GET /v1/verify/:id", () => {
  it("returns 200 + state=verified for a valid email envelope", async () => {
    const sc = plantScenario();
    const payload = makeEmailPayload({ companyId: "company-a" });
    const envelope = buildEnvelope({
      payload,
      payloadType: "email",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
      ],
    });
    sc.store.set("signed_messages", "msg-001", envelope as unknown as Record<string, unknown>);

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/msg-001");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("verified");
    expect(res.body.signers[0].companyDomain).toBe("company-a.com");
    expect(typeof res.body.anchor.blockNumber).toBe("string");
  });

  it("returns 200 + state=bilateral for a valid bilateral document", async () => {
    const sc = plantScenario();
    const payload = makeBilateralPayload();
    const envelope = buildEnvelope({
      payload,
      payloadType: "bilateral",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
        { userId: "user-b", credentialId: sc.credBId, privateKey: sc.userBKp.privateKey },
      ],
    });
    sc.store.set(
      "bilateral_documents",
      "doc-001",
      envelope as unknown as Record<string, unknown>,
    );

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/doc-001");

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("bilateral");
    expect(res.body.signers).toHaveLength(2);
  });

  it("returns 200 + state=rejected with PAYLOAD_HASH_MISMATCH for tampered payload", async () => {
    const sc = plantScenario();
    const payload = makeEmailPayload({ companyId: "company-a" });
    const envelope = buildEnvelope({
      payload,
      payloadType: "email",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
      ],
    });
    // Recompute hash for a different payload, so payloadHash mismatches the
    // canonicalized payload that ships in the doc.
    const tamperedHash = hashPayload({ ...payload, body: "tampered" });
    const tampered = { ...envelope, payloadHash: tamperedHash };
    sc.store.set("signed_messages", "msg-tampered", tampered as unknown as Record<string, unknown>);

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/msg-tampered");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.state).toBe("rejected");
    expect(res.body.code).toBe("PAYLOAD_HASH_MISMATCH");
  });

  it("returns 200 + state=rejected with PAYLOAD_EXPIRED for an expired email envelope", async () => {
    const sc = plantScenario();
    const expiredAt = Math.floor(Date.now() / 1000) - 3600;
    const payload = makeEmailPayload({
      issuedAt: expiredAt - 7200,
      expiresAt: expiredAt,
      companyId: "company-a",
    });
    const envelope = buildEnvelope({
      payload,
      payloadType: "email",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
      ],
    });
    sc.store.set("signed_messages", "msg-expired", envelope as unknown as Record<string, unknown>);

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/msg-expired");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.state).toBe("rejected");
    expect(res.body.code).toBe("PAYLOAD_EXPIRED");
  });

  it("returns 200 + state=suspected_spoof when a verified-domain envelope has an invalid signature", async () => {
    const sc = plantScenario();
    const payload = makeEmailPayload({ companyId: "company-a" });
    const envelope = buildEnvelope({
      payload,
      payloadType: "email",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
      ],
    });
    // Tamper signature bytes so the credential resolves but signature fails.
    const tampered = {
      ...envelope,
      signers: [{ ...envelope.signers[0], sig: "AAAA" }],
    };
    sc.store.set("signed_messages", "msg-spoof", tampered as unknown as Record<string, unknown>);

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/msg-spoof");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("suspected_spoof");
    expect(res.body.claimedCompany.companyId).toBe("company-a");
    expect(res.body.claimedCompany.domain).toBe("company-a.com");
  });

  it("returns 200 + state=unverified_sender when no envelope exists at the requested id", async () => {
    const sc = plantScenario();
    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/no-such-message");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, state: "unverified_sender" });
  });

  it("returns 400 + INVALID_ID when the path id is malformed", async () => {
    const sc = plantScenario();
    const app = buildApp(sc);
    // path '!!invalid!!' contains url-unsafe chars that get percent-encoded
    // and won't match the validation regex once express decodes them.
    const res = await request(app).get("/v1/verify/!!invalid!!");

    expect(res.status).toBe(400);
    expect(res.body.title).toBe("INVALID_ID");
  });

  it("sets Cache-Control + CORS headers on success", async () => {
    const sc = plantScenario();
    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/no-such-message");

    expect(res.headers["cache-control"]).toBe("public, max-age=60, s-maxage=300");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(res.headers["access-control-max-age"]).toBe("86400");
  });
});

describe("OPTIONS /v1/verify/:id (preflight)", () => {
  it("returns 204 with CORS headers", async () => {
    const sc = plantScenario();
    const app: express.Express = buildApp(sc);
    const res = await request(app).options("/v1/verify/preflight-id");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
