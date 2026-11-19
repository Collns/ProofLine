/**
 * PFL-026 — counterparty invitation service rules.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { makeInvitationService, makeMemoryInvitationStore, hashToken, DEFAULT_TTL_MS } from "../index.js";
import type { InvitationService, Inviter } from "../index.js";

const ACME: Inviter = { companyId: "co-acme", companyName: "Acme Title", companyDomain: "acme-title.com", userId: "u-sarah" };
const OTHER: Inviter = { companyId: "co-other", companyName: "Other Co", companyDomain: "other.com", userId: "u-x" };

let clock: number;
let store: ReturnType<typeof makeMemoryInvitationStore>;
let svc: InvitationService;
let seq: number;

beforeEach(() => {
  clock = 1_800_000_000_000;
  seq = 0;
  store = makeMemoryInvitationStore();
  svc = makeInvitationService({
    store,
    now:      () => clock,
    newId:    () => `inv_${++seq}`,
    newToken: () => `tok_${seq}_${clock}`,
  });
});

async function created(email = "Bob@Scotia.example") {
  const r = await svc.create(ACME, { email, message: "  Please join us  " });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}

describe("create", () => {
  it("creates a sent invitation with a normalized email and 30-day expiry", async () => {
    const { invitation, token } = await created();
    expect(invitation).toMatchObject({
      id: "inv_1", email: "bob@scotia.example", status: "sent", message: "Please join us",
      inviterCompanyId: "co-acme", sentAt: clock, expiresAt: clock + DEFAULT_TTL_MS,
    });
    expect(token).toBe(`tok_0_${clock}`);
  });

  it("stores only the token hash, never the token", async () => {
    const { invitation, token } = await created();
    const rec = await store.get(invitation.id);
    expect(rec!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rec)).not.toContain(token);
    expect(invitation).not.toHaveProperty("tokenHash");
  });

  it("rejects invalid emails, the inviter's own domain and duplicates", async () => {
    expect(await svc.create(ACME, { email: "not-an-email" })).toMatchObject({ ok: false, code: "INVALID_EMAIL" });
    expect(await svc.create(ACME, { email: "ops@acme-title.com" })).toMatchObject({ ok: false, code: "SELF_DOMAIN" });
    await created();
    expect(await svc.create(ACME, { email: "bob@scotia.example" })).toMatchObject({ ok: false, code: "ALREADY_INVITED" });
  });

  it("allows a new invitation once the previous one expired or was cancelled", async () => {
    const first = await created();
    clock += DEFAULT_TTL_MS + 1;
    expect((await svc.create(ACME, { email: "bob@scotia.example" })).ok).toBe(true);
    await svc.cancel(ACME.companyId, first.invitation.id);
    expect((await svc.create(OTHER, { email: "bob@scotia.example" })).ok).toBe(true);
  });

  it("rejects overly long messages", async () => {
    expect(await svc.create(ACME, { email: "a@b.example", message: "x".repeat(1001) }))
      .toMatchObject({ ok: false, code: "MESSAGE_TOO_LONG" });
  });
});

describe("bulkCreate", () => {
  it("creates valid addresses and explains every skip", async () => {
    await created("existing@x.example");
    const r = await svc.bulkCreate(ACME, {
      emails: ["a@one.example", "A@ONE.example", "bad", "me@acme-title.com", "existing@x.example", "b@two.example"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created.map((c) => c.invitation.email)).toEqual(["a@one.example", "b@two.example"]);
    expect(r.value.skipped).toEqual([
      { email: "A@ONE.example", reason: "duplicate_in_batch" },
      { email: "bad", reason: "invalid_email" },
      { email: "me@acme-title.com", reason: "self_domain" },
      { email: "existing@x.example", reason: "already_invited" },
    ]);
  });

  it("caps a batch at the bulk limit", async () => {
    const svc3 = makeInvitationService({ store, now: () => clock, bulkLimit: 2 });
    const r = await svc3.bulkCreate(ACME, { emails: ["a@x.example", "b@x.example", "c@x.example"] });
    expect(r.ok && r.value.created).toHaveLength(2);
    expect(r.ok && r.value.skipped).toEqual([{ email: "c@x.example", reason: "over_limit" }]);
  });
});

describe("list / get / scoping", () => {
  it("lists newest first with status filter, search and pagination", async () => {
    await created("first@x.example");
    clock += 1000;
    await created("second@y.example");
    clock += DEFAULT_TTL_MS - 500; // first expired, second still pending

    const all = await svc.list(ACME.companyId, { pageSize: 1 });
    expect(all).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(all.items[0]!.email).toBe("second@y.example");

    expect((await svc.list(ACME.companyId, { status: "expired" })).items.map((i) => i.email)).toEqual(["first@x.example"]);
    expect((await svc.list(ACME.companyId, { search: "SECOND" })).total).toBe(1);
  });

  it("never exposes another company's invitations", async () => {
    const { invitation } = await created();
    expect(await svc.get(OTHER.companyId, invitation.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await svc.cancel(OTHER.companyId, invitation.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await svc.list(OTHER.companyId)).total).toBe(0);
  });
});

describe("resend / cancel", () => {
  it("resend issues a new token and expiry, and the old link stops working", async () => {
    const { invitation, token: oldToken } = await created();
    clock += DEFAULT_TTL_MS + 10; // expired
    const r = await svc.resend(ACME.companyId, invitation.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.invitation).toMatchObject({ status: "sent", sentAt: clock, expiresAt: clock + DEFAULT_TTL_MS });
    expect(r.value.token).not.toBe(oldToken);

    const accepting = { companyId: "co-scotia", companyName: "Scotia", companyDomain: "scotia.example" };
    expect(await svc.accept(oldToken, accepting)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await svc.accept(r.value.token, accepting)).ok).toBe(true);
  });

  it("cancel only applies to pending invitations", async () => {
    const { invitation } = await created();
    expect(await svc.cancel(ACME.companyId, invitation.id)).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(await svc.cancel(ACME.companyId, invitation.id)).toMatchObject({ ok: false, code: "WRONG_STATUS" });
    expect(await svc.resend(ACME.companyId, invitation.id)).toMatchObject({ ok: false, code: "WRONG_STATUS" });
  });
});

describe("accept", () => {
  const scotia = { companyId: "co-scotia", companyName: "Scotia", companyDomain: "scotia.example" };

  it("accepts with a matching domain and records the accepting company", async () => {
    const { token } = await created();
    const r = await svc.accept(token, scotia);
    expect(r).toMatchObject({
      ok: true,
      value: { status: "accepted", acceptedAt: clock, acceptingCompanyId: "co-scotia", acceptingCompanyName: "Scotia" },
    });
    expect(await svc.accept(token, scotia)).toMatchObject({ ok: false, code: "WRONG_STATUS" });
  });

  it("rejects a different domain, an expired link and an unknown token", async () => {
    const { token } = await created();
    expect(await svc.accept(token, { ...scotia, companyDomain: "evil.example" })).toMatchObject({ ok: false, code: "DOMAIN_MISMATCH" });
    clock += DEFAULT_TTL_MS;
    expect(await svc.accept(token, scotia)).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(await svc.accept("nope", scotia)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("stats", () => {
  it("counts each status and computes coverage excluding cancelled", async () => {
    const a = await created("a@scotia.example");
    await created("b@two.example");
    const c = await created("c@three.example");
    const d = await created("d@four.example");
    await svc.accept(a.token, { companyId: "s", companyName: "S", companyDomain: "scotia.example" });
    await svc.cancel(ACME.companyId, c.invitation.id);
    // expire d only: move its expiry into the past
    const rec = (await store.get(d.invitation.id))!;
    await store.put({ ...rec, expiresAt: clock - 1 });

    expect(await svc.stats(ACME.companyId)).toEqual({
      totalInvited: 4, verified: 1, pending: 1, expired: 1, cancelled: 1, coveragePercent: 33,
    });
    expect((await svc.stats("empty")).coveragePercent).toBe(0);
  });
});
