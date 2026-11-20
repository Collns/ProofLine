/**
 * PFL-187 — sign-time sender-domain binding: a message is rejected before a
 * challenge is issued when its From address isn't on the signer company's
 * verified domain (or an allowed alias / test company).
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { EmailPayload } from "@proofline/types";

import { makeSignHandler, senderAllowed, type CompanySenderIdentity } from "../handlers/sign.handler.js";
import { makeStubPolicyContext } from "../../wiring/stubs.js";

const COMPANY = "acme-title";
const USER = "sarah-01";
const CRED = "cred-sarah";

function emailPayload(from: string): EmailPayload {
  return {
    v: 1, from, to: ["mark@scotiabank.com"], cc: [], bcc: [],
    subject: "Closing documents", body: "Please review.", isWireInstruction: false,
    issuedAt: 1_700_000_000_000, expiresAt: 1_700_000_000_000 + 86_400_000,
    nonce: "y8f3k2m9p1q7r5s6t0v4w8x2", companyId: COMPANY,
  };
}

function buildApp(loadCompanyIdentity: (id: string) => Promise<CompanySenderIdentity | null>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { user: unknown }).user = { userId: USER, companyId: COMPANY }; next(); });
  const ctx = makeStubPolicyContext({ credentialId: CRED, userId: USER, companyId: COMPANY });
  app.post("/v1/sign", (req, res, next) => { makeSignHandler(ctx, { loadCompanyIdentity })(req, res).catch(next); });
  return app;
}

function sign(app: express.Express, from: string) {
  return request(app).post("/v1/sign").send({
    payload: emailPayload(from), recipientSetHash: "a".repeat(64), credentialId: CRED, freshBiometric: true,
  });
}

describe("senderAllowed", () => {
  const acme: CompanySenderIdentity = { domain: "acme-title.com" };
  it("allows the verified domain, case-insensitively", () => {
    expect(senderAllowed("sarah@acme-title.com", acme)).toBe(true);
    expect(senderAllowed("Sarah@Acme-Title.com", acme)).toBe(true);
  });
  it("rejects a different domain", () => {
    expect(senderAllowed("danievwe@gmail.com", acme)).toBe(false);
  });
  it("allows an alias domain and an exact allowed address", () => {
    expect(senderAllowed("x@mail.acme-title.com", { ...acme, allowedFromDomains: ["mail.acme-title.com"] })).toBe(true);
    expect(senderAllowed("danievwe@gmail.com", { ...acme, allowedFromAddresses: ["danievwe@gmail.com"] })).toBe(true);
  });
  it("allows anything for a test company", () => {
    expect(senderAllowed("danievwe@gmail.com", { ...acme, testCompany: true })).toBe(true);
  });
});

describe("POST /v1/sign sender-domain binding", () => {
  const load = (id: CompanySenderIdentity | null) => vi.fn(async () => id);

  it("rejects 403 SENDER_DOMAIN_MISMATCH when From is off-domain", async () => {
    const res = await sign(buildApp(load({ domain: "acme-title.com" })), "danievwe@gmail.com");
    expect(res.status).toBe(403);
    expect(res.body.title ?? res.body.type).toMatch(/SENDER_DOMAIN_MISMATCH/);
  });

  it("does not reject on the domain gate when From is on the verified domain", async () => {
    const res = await sign(buildApp(load({ domain: "acme-title.com" })), "sarah@acme-title.com");
    expect(res.status).not.toBe(403);
  });

  it("does not reject for a test company signing off-domain", async () => {
    const res = await sign(buildApp(load({ domain: "acme-title.com", testCompany: true })), "danievwe@gmail.com");
    expect(res.status).not.toBe(403);
  });

  it("rejects 403 when the company can't be loaded", async () => {
    const res = await sign(buildApp(load(null)), "sarah@acme-title.com");
    expect(res.status).toBe(403);
  });
});
