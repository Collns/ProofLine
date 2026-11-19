/**
 * PFL-026 — /v1/invitations: role + verification guard, company scoping,
 * web-admin response shapes, and token handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { makeInvitationService, makeMemoryInvitationStore, hashToken } from "@proofline/invitations";
import type { IssuedInvitation } from "@proofline/invitations";

import { makeInvitationsRouter } from "../router.js";

const COMPANIES: Record<string, { legalName: string; domain: string; status?: string }> = {
  "co-acme":    { legalName: "Acme Title", domain: "acme-title.com", status: "verified" },
  "co-other":   { legalName: "Other Co", domain: "other.com", status: "verified" },
  "co-pending": { legalName: "New Co", domain: "new.com" },
};

let store: ReturnType<typeof makeMemoryInvitationStore>;
let delivered: IssuedInvitation[];

function app(user: { userId?: string; companyId?: string; role?: string }, deliverImpl?: (i: IssuedInvitation) => Promise<void>) {
  const a = express();
  a.use((req, _res, next) => { (req as express.Request & { user: unknown }).user = user; next(); });
  a.use("/v1/invitations", makeInvitationsRouter({
    service:     makeInvitationService({ store }),
    loadCompany: async (id) => COMPANIES[id] ?? null,
    deliver:     deliverImpl ?? (async (i) => { delivered.push(i); }),
  }));
  return a;
}

const owner   = { userId: "u-owner", companyId: "co-acme", role: "owner" };
const manager = { userId: "u-mgr", companyId: "co-acme", role: "manager" };

beforeEach(() => {
  store = makeMemoryInvitationStore();
  delivered = [];
});

describe("guard", () => {
  it("requires owner/manager on a verified company", async () => {
    expect((await request(app({ ...owner, role: "member" })).get("/v1/invitations")).body)
      .toEqual({ error: { code: "FORBIDDEN_ROLE", message: expect.any(String) } });
    expect((await request(app({ userId: "u", companyId: "co-pending", role: "owner" })).get("/v1/invitations")).body.error.code)
      .toBe("COMPANY_NOT_VERIFIED");
    expect((await request(app({})).get("/v1/invitations")).status).toBe(401);
    expect((await request(app(manager)).get("/v1/invitations")).status).toBe(200);
  });
});

describe("create / bulk", () => {
  it("creates one invitation, delivers the token, and never returns it", async () => {
    const res = await request(app(owner)).post("/v1/invitations").send({ email: "Bob@Scotia.example", message: "Join us" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "bob@scotia.example", status: "sent", inviterCompanyName: "Acme Title" });
    expect(res.body).not.toHaveProperty("token");
    expect(res.body).not.toHaveProperty("tokenHash");
    expect(delivered).toHaveLength(1);
    expect((await store.get(res.body.id))!.tokenHash).toBe(hashToken(delivered[0]!.token));
  });

  it("maps service errors to statuses in the web-admin error shape", async () => {
    const a = app(owner);
    expect((await request(a).post("/v1/invitations").send({ email: "ops@acme-title.com" })).body.error.code).toBe("SELF_DOMAIN");
    await request(a).post("/v1/invitations").send({ email: "bob@scotia.example" });
    const dup = await request(a).post("/v1/invitations").send({ email: "bob@scotia.example" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_INVITED");
    expect((await request(a).post("/v1/invitations").send({})).status).toBe(400);
  });

  it("bulk returns plain invitations plus skip reasons", async () => {
    const res = await request(app(owner)).post("/v1/invitations/bulk").send({ emails: ["a@one.example", "bad", "a@one.example"] });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0]).not.toHaveProperty("token");
    expect(res.body.skipped).toEqual([
      { email: "bad", reason: "invalid_email" },
      { email: "a@one.example", reason: "duplicate_in_batch" },
    ]);
    expect(delivered).toHaveLength(1);
  });

  it("still creates the invitation when delivery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app(owner, async () => { throw new Error("smtp down"); }))
      .post("/v1/invitations").send({ email: "c@three.example" });
    warn.mockRestore();
    expect(res.status).toBe(201);
  });
});

describe("read / resend / cancel", () => {
  it("lists, gets, resends and cancels within the caller's company only", async () => {
    const a = app(owner);
    const { body: inv } = await request(a).post("/v1/invitations").send({ email: "bob@scotia.example" });

    const list = await request(a).get("/v1/invitations").query({ status: "sent", pageSize: 10 });
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect((await request(a).get(`/v1/invitations/${inv.id}`)).body.id).toBe(inv.id);
    expect((await request(a).get("/v1/invitations/stats")).body).toMatchObject({ totalInvited: 1, pending: 1 });

    const other = app({ userId: "u-x", companyId: "co-other", role: "owner" });
    expect((await request(other).get(`/v1/invitations/${inv.id}`)).status).toBe(404);
    expect((await request(other).delete(`/v1/invitations/${inv.id}`)).status).toBe(404);

    const resent = await request(a).post(`/v1/invitations/${inv.id}/resend`);
    expect(resent.status).toBe(200);
    expect(delivered).toHaveLength(2);
    expect(delivered[1]!.token).not.toBe(delivered[0]!.token);

    expect((await request(a).delete(`/v1/invitations/${inv.id}`)).status).toBe(204);
    const again = await request(a).post(`/v1/invitations/${inv.id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("WRONG_STATUS");
  });

  it("rejects bad list queries", async () => {
    expect((await request(app(owner)).get("/v1/invitations").query({ status: "weird" })).status).toBe(400);
  });
});
