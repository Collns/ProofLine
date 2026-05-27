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

  it("PFL-101 trust mode: handler skips raw-ECDSA signature check (suspected_spoof coverage lives in @proofline/verification tests)", async () => {
    // PFL-101: the verify handler passes `trustWebauthnAtSignTime: true`
    // to verifyEnvelope because the stored `signer.sig` is a WebAuthn
    // assertion sig (over clientDataJSON+authenticatorData), not over
    // canonicalize(payload). Trust mode skips checkSignatures, so a
    // tampered raw sig no longer trips suspected_spoof at THIS layer.
    //
    // The "tampered sig → suspected_spoof" guarantee still holds with
    // trust mode OFF; the verification package's
    // verify-suspected-spoof.test.ts + verify.test.ts SIGNATURE_INVALID
    // describe-block cover that path.
    //
    // This handler-level test documents the trust-mode tradeoff so the
    // moment PFL-101.x flips trust off, the assertion below will start
    // failing and we'll be reminded to restore the suspected_spoof
    // expectation here.
    const sc = plantScenario();
    const payload = makeEmailPayload({ companyId: "company-a" });
    const envelope = buildEnvelope({
      payload,
      payloadType: "email",
      signers: [
        { userId: "user-a", credentialId: sc.credAId, privateKey: sc.userAKp.privateKey },
      ],
    });
    const tampered = {
      ...envelope,
      signers: [{ ...envelope.signers[0], sig: "AAAA" }],
    };
    sc.store.set("signed_messages", "msg-spoof", tampered as unknown as Record<string, unknown>);

    const app = buildApp(sc);
    const res = await request(app).get("/v1/verify/msg-spoof");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.state).toBe("verified"); // PFL-101.x: flip back to "suspected_spoof" when trust mode is removed
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
