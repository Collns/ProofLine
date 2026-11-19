/**
 * @file service.ts
 * @module packages/invitations
 *
 * Counterparty invitation service (PFL-026). Pure business rules over an
 * injected InvitationStore; HTTP routing, auth and email delivery live in
 * apps/functions.
 *
 * Rules:
 *   - One active ("sent", not expired) invitation per inviter + email.
 *   - Inviting an address at the inviter's own domain is rejected.
 *   - Bulk create accepts at most `bulkLimit` (default 100) addresses.
 *   - Each send/resend issues a fresh one-time token; only its sha256 is stored.
 *   - Accepting requires the accepting company's verified domain to match
 *     the invited email's domain.
 *   - Expiry is derived from expiresAt (default 30 days); no cron needed.
 */

import * as crypto from "node:crypto";

import type {
  BulkInvitationInput,
  BulkInvitationResult,
  BulkSkipReason,
  Invitation,
  InvitationInput,
  InvitationRecord,
  InvitationStore,
  Inviter,
  IssuedInvitation,
  ListInvitationsOptions,
  ListInvitationsResult,
  NetworkStats,
  Result,
} from "./types.js";

export const DEFAULT_TTL_MS     = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_BULK_LIMIT = 100;
export const MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE     = 100;

// Deliberately simple: the address must have one @, a non-empty local part
// and a dotted domain. Delivery is the real test.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InvitationServiceDeps {
  store:       InvitationStore;
  now?:        () => number;
  newId?:      () => string;
  newToken?:   () => string;
  ttlMs?:      number;
  bulkLimit?:  number;
}

export interface InvitationService {
  create(inviter: Inviter, input: InvitationInput): Promise<Result<IssuedInvitation>>;
  bulkCreate(inviter: Inviter, input: BulkInvitationInput): Promise<Result<BulkInvitationResult>>;
  list(companyId: string, opts?: ListInvitationsOptions): Promise<ListInvitationsResult>;
  get(companyId: string, id: string): Promise<Result<Invitation>>;
  resend(companyId: string, id: string): Promise<Result<IssuedInvitation>>;
  cancel(companyId: string, id: string): Promise<Result<Invitation>>;
  accept(
    token: string,
    accepting: { companyId: string; companyName: string; companyDomain: string },
  ): Promise<Result<Invitation>>;
  stats(companyId: string): Promise<NetworkStats>;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function fail<T>(code: Extract<Result<T>, { ok: false }>["code"], detail: string): Result<T> {
  return { ok: false, code, detail };
}

export function makeInvitationService(deps: InvitationServiceDeps): InvitationService {
  const { store } = deps;
  const now       = deps.now ?? (() => Date.now());
  const newId     = deps.newId ?? (() => `inv_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);
  const newToken  = deps.newToken ?? (() => crypto.randomBytes(32).toString("base64url"));
  const ttlMs     = deps.ttlMs ?? DEFAULT_TTL_MS;
  const bulkLimit = deps.bulkLimit ?? DEFAULT_BULK_LIMIT;

  function toPublic(rec: InvitationRecord, at: number = now()): Invitation {
    const status = rec.status === "sent" && rec.expiresAt <= at ? "expired" : rec.status;
    return {
      id:                   rec.id,
      inviterCompanyId:     rec.inviterCompanyId,
      inviterCompanyName:   rec.inviterCompanyName,
      email:                rec.email,
      status,
      sponsoredCost:        rec.sponsoredCost,
      message:              rec.message,
      sentAt:               rec.sentAt,
      expiresAt:            rec.expiresAt,
      acceptedAt:           rec.acceptedAt,
      cancelledAt:          rec.cancelledAt,
      acceptingCompanyId:   rec.acceptingCompanyId,
      acceptingCompanyName: rec.acceptingCompanyName,
    };
  }

  function isActive(rec: InvitationRecord, at: number): boolean {
    return rec.status === "sent" && rec.expiresAt > at;
  }

  function checkEmail(inviter: Inviter, raw: string): { email: string } | { reason: BulkSkipReason } {
    const email = normalizeEmail(raw);
    if (!EMAIL_RE.test(email)) return { reason: "invalid_email" };
    if (domainOf(email) === inviter.companyDomain.toLowerCase()) return { reason: "self_domain" };
    return { email };
  }

  function checkMessage(message: string | undefined): string | null {
    const m = message?.trim();
    return m ? m : null;
  }

  async function issue(
    inviter: Inviter,
    email: string,
    input: { sponsoredCost?: boolean; message?: string },
    at: number,
  ): Promise<IssuedInvitation> {
    const token = newToken();
    const rec: InvitationRecord = {
      id:                   newId(),
      inviterCompanyId:     inviter.companyId,
      inviterCompanyName:   inviter.companyName,
      inviterUserId:        inviter.userId,
      email,
      status:               "sent",
      sponsoredCost:        input.sponsoredCost ?? false,
      message:              checkMessage(input.message),
      sentAt:               at,
      expiresAt:            at + ttlMs,
      acceptedAt:           null,
      cancelledAt:          null,
      acceptingCompanyId:   null,
      acceptingCompanyName: null,
      tokenHash:            hashToken(token),
      sendCount:            1,
      updatedAt:            at,
    };
    await store.put(rec);
    return { invitation: toPublic(rec, at), token };
  }

  async function activeEmails(companyId: string, at: number): Promise<Set<string>> {
    const existing = await store.listByInviter(companyId);
    return new Set(existing.filter((r) => isActive(r, at)).map((r) => r.email));
  }

  async function ownRecord(companyId: string, id: string): Promise<InvitationRecord | null> {
    const rec = await store.get(id);
    // Another company's invitation is reported as not found, not forbidden.
    return rec && rec.inviterCompanyId === companyId ? rec : null;
  }

  return {
    async create(inviter, input) {
      if ((input.message?.length ?? 0) > MAX_MESSAGE_LENGTH) {
        return fail("MESSAGE_TOO_LONG", `Message must be at most ${MAX_MESSAGE_LENGTH} characters`);
      }
      const checked = checkEmail(inviter, input.email);
      if ("reason" in checked) {
        return checked.reason === "self_domain"
          ? fail("SELF_DOMAIN", "You can't invite an address at your own domain")
          : fail("INVALID_EMAIL", `"${input.email}" is not a valid email address`);
      }
      const at = now();
      if ((await activeEmails(inviter.companyId, at)).has(checked.email)) {
        return fail("ALREADY_INVITED", `${checked.email} already has a pending invitation`);
      }
      return { ok: true, value: await issue(inviter, checked.email, input, at) };
    },

    async bulkCreate(inviter, input) {
      if ((input.message?.length ?? 0) > MAX_MESSAGE_LENGTH) {
        return fail("MESSAGE_TOO_LONG", `Message must be at most ${MAX_MESSAGE_LENGTH} characters`);
      }
      const at = now();
      const active = await activeEmails(inviter.companyId, at);
      const seen = new Set<string>();
      const created: IssuedInvitation[] = [];
      const skipped: { email: string; reason: BulkSkipReason }[] = [];

      for (const raw of input.emails) {
        if (created.length + skipped.length >= bulkLimit) {
          skipped.push({ email: raw, reason: "over_limit" });
          continue;
        }
        const checked = checkEmail(inviter, raw);
        if ("reason" in checked) {
          skipped.push({ email: raw, reason: checked.reason });
          continue;
        }
        if (seen.has(checked.email)) {
          skipped.push({ email: raw, reason: "duplicate_in_batch" });
          continue;
        }
        seen.add(checked.email);
        if (active.has(checked.email)) {
          skipped.push({ email: raw, reason: "already_invited" });
          continue;
        }
        created.push(await issue(inviter, checked.email, input, at));
      }
      return { ok: true, value: { created, skipped } };
    },

    async list(companyId, opts = {}) {
      const at = now();
      const page     = Math.max(1, Math.floor(opts.page ?? 1));
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE)));
      const search   = opts.search?.trim().toLowerCase();

      let items = (await store.listByInviter(companyId)).map((r) => toPublic(r, at));
      if (opts.status && opts.status !== "all") items = items.filter((i) => i.status === opts.status);
      if (search) {
        items = items.filter((i) =>
          i.email.includes(search) || (i.acceptingCompanyName ?? "").toLowerCase().includes(search));
      }
      items.sort((a, b) => b.sentAt - a.sentAt);

      return {
        items:    items.slice((page - 1) * pageSize, page * pageSize),
        total:    items.length,
        page,
        pageSize,
      };
    },

    async get(companyId, id) {
      const rec = await ownRecord(companyId, id);
      return rec ? { ok: true, value: toPublic(rec) } : fail("NOT_FOUND", `Invitation ${id} not found`);
    },

    async resend(companyId, id) {
      const rec = await ownRecord(companyId, id);
      if (!rec) return fail("NOT_FOUND", `Invitation ${id} not found`);
      if (rec.status !== "sent") {
        return fail("WRONG_STATUS", `Only pending or expired invitations can be resent (status: ${rec.status})`);
      }
      const at = now();
      const token = newToken();
      const updated: InvitationRecord = {
        ...rec,
        sentAt:    at,
        expiresAt: at + ttlMs,
        tokenHash: hashToken(token), // the previous link stops working
        sendCount: rec.sendCount + 1,
        updatedAt: at,
      };
      await store.put(updated);
      return { ok: true, value: { invitation: toPublic(updated, at), token } };
    },

    async cancel(companyId, id) {
      const rec = await ownRecord(companyId, id);
      if (!rec) return fail("NOT_FOUND", `Invitation ${id} not found`);
      if (rec.status !== "sent") {
        return fail("WRONG_STATUS", `Only pending invitations can be cancelled (status: ${rec.status})`);
      }
      const at = now();
      const updated: InvitationRecord = { ...rec, status: "cancelled", cancelledAt: at, updatedAt: at };
      await store.put(updated);
      return { ok: true, value: toPublic(updated, at) };
    },

    async accept(token, accepting) {
      const rec = await store.findByTokenHash(hashToken(token));
      if (!rec) return fail("NOT_FOUND", "Invitation link is invalid or has been replaced");
      const at = now();
      if (rec.status !== "sent") {
        return fail("WRONG_STATUS", `Invitation is ${rec.status}`);
      }
      if (rec.expiresAt <= at) return fail("EXPIRED", "Invitation has expired");
      if (domainOf(rec.email) !== accepting.companyDomain.toLowerCase()) {
        return fail("DOMAIN_MISMATCH", `Invitation was sent to an address at ${domainOf(rec.email)}`);
      }
      const updated: InvitationRecord = {
        ...rec,
        status:               "accepted",
        acceptedAt:           at,
        acceptingCompanyId:   accepting.companyId,
        acceptingCompanyName: accepting.companyName,
        updatedAt:            at,
      };
      await store.put(updated);
      return { ok: true, value: toPublic(updated, at) };
    },

    async stats(companyId) {
      const at = now();
      const items = (await store.listByInviter(companyId)).map((r) => toPublic(r, at));
      const count = (s: Invitation["status"]) => items.filter((i) => i.status === s).length;
      const verified  = count("accepted");
      const cancelled = count("cancelled");
      const denominator = items.length - cancelled;
      return {
        totalInvited:    items.length,
        verified,
        pending:         count("sent"),
        expired:         count("expired"),
        cancelled,
        coveragePercent: denominator > 0 ? Math.round((verified / denominator) * 100) : 0,
      };
    },
  };
}
