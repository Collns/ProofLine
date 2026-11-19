/**
 * @file router.ts
 * @module apps/functions/src/api/invitations
 *
 * /v1/invitations — counterparty invitations (PFL-026). Mounted behind
 * makeFirebaseAuth({ requireCompany: true }), which sets req.user from the
 * caller's users/{uid} doc. This router additionally requires:
 *   - role owner or manager (403 FORBIDDEN_ROLE)
 *   - the caller's company to be verified (403 COMPANY_NOT_VERIFIED)
 *
 *   GET    /             list (status, page, pageSize, search)
 *   GET    /stats        network coverage
 *   GET    /:id          one invitation
 *   POST   /             create one            → Invitation
 *   POST   /bulk         create up to 100      → { created: Invitation[], skipped }
 *   POST   /:id/resend   new token + expiry    → Invitation
 *   POST   /:id/cancel   cancel                → Invitation
 *   DELETE /:id          cancel                → 204
 *
 * Every lookup is scoped to the caller's companyId; another company's
 * invitation is a 404. Errors use the web-admin shape
 * { error: { code, message } }.
 *
 * Email delivery of the invite link is PFL-132: `deliver` is called for
 * each issued token when provided. The token is never returned to the
 * caller or logged.
 */

import * as express from "express";
import { z } from "zod";

import type {
  InvitationErrorCode,
  InvitationService,
  Inviter,
  IssuedInvitation,
} from "@proofline/invitations";

export interface InvitationsRouterDeps {
  service: InvitationService;
  /** Loads the caller's company (name, domain, verification status). */
  loadCompany(companyId: string): Promise<{ legalName: string; domain: string; status?: string } | null>;
  /** Sends the invite link (PFL-132). Failures are logged, not surfaced. */
  deliver?: (issued: IssuedInvitation, inviter: Inviter) => Promise<void>;
}

const ALLOWED_ROLES = new Set(["owner", "manager"]);

const CreateSchema = z.object({
  email:         z.string().trim().min(3).max(320),
  sponsoredCost: z.boolean().optional(),
  message:       z.string().max(5000).optional(),
});

const BulkSchema = z.object({
  emails:        z.array(z.string().max(320)).min(1).max(1000),
  sponsoredCost: z.boolean().optional(),
  message:       z.string().max(5000).optional(),
});

const ListQuerySchema = z.object({
  status:   z.enum(["all", "sent", "accepted", "expired", "cancelled"]).optional(),
  page:     z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search:   z.string().max(320).optional(),
});

function sendError(res: express.Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function statusFor(code: InvitationErrorCode): number {
  switch (code) {
    case "NOT_FOUND":       return 404;
    case "ALREADY_INVITED":
    case "WRONG_STATUS":    return 409;
    case "EXPIRED":         return 410;
    default:                return 400;
  }
}

type AuthedRequest = express.Request & { user?: { userId?: string; companyId?: string; role?: string } };

export function makeInvitationsRouter(deps: InvitationsRouterDeps): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "200kb" }));

  // ── Guard: role + verified company; resolves the inviter ─────────────────
  router.use(async (req: AuthedRequest, res, next) => {
    const user = req.user;
    if (!user?.userId || !user.companyId) {
      sendError(res, 401, "UNAUTHENTICATED", "Sign in required.");
      return;
    }
    if (!user.role || !ALLOWED_ROLES.has(user.role)) {
      sendError(res, 403, "FORBIDDEN_ROLE", "Only owners and managers can manage invitations.");
      return;
    }
    try {
      const company = await deps.loadCompany(user.companyId);
      if (!company || company.status !== "verified") {
        sendError(res, 403, "COMPANY_NOT_VERIFIED", "Your company must finish verification before inviting counterparties.");
        return;
      }
      res.locals["inviter"] = {
        companyId:     user.companyId,
        companyName:   company.legalName,
        companyDomain: company.domain,
        userId:        user.userId,
      } satisfies Inviter;
      next();
    } catch (err) {
      next(err);
    }
  });

  const inviterOf = (res: express.Response) => res.locals["inviter"] as Inviter;

  async function deliverAll(issued: IssuedInvitation[], inviter: Inviter): Promise<void> {
    if (!deps.deliver) return;
    for (const item of issued) {
      try {
        await deps.deliver(item, inviter);
      } catch (err) {
        console.warn(`[invitations] delivery failed for ${item.invitation.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler =>
    (req, res, next) => { fn(req, res).catch(next); };

  router.get("/", wrap(async (req, res) => {
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return sendError(res, 400, "BAD_REQUEST", q.error.issues[0]?.message ?? "Invalid query");
    res.json(await deps.service.list(inviterOf(res).companyId, q.data));
  }));

  router.get("/stats", wrap(async (_req, res) => {
    res.json(await deps.service.stats(inviterOf(res).companyId));
  }));

  router.get("/:id", wrap(async (req, res) => {
    const r = await deps.service.get(inviterOf(res).companyId, String(req.params["id"]));
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    res.json(r.value);
  }));

  router.post("/", wrap(async (req, res) => {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) return sendError(res, 400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
    const inviter = inviterOf(res);
    const r = await deps.service.create(inviter, body.data);
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    await deliverAll([r.value], inviter);
    res.status(201).json(r.value.invitation);
  }));

  router.post("/bulk", wrap(async (req, res) => {
    const body = BulkSchema.safeParse(req.body);
    if (!body.success) return sendError(res, 400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
    const inviter = inviterOf(res);
    const r = await deps.service.bulkCreate(inviter, body.data);
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    await deliverAll(r.value.created, inviter);
    res.status(201).json({ created: r.value.created.map((c) => c.invitation), skipped: r.value.skipped });
  }));

  router.post("/:id/resend", wrap(async (req, res) => {
    const inviter = inviterOf(res);
    const r = await deps.service.resend(inviter.companyId, String(req.params["id"]));
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    await deliverAll([r.value], inviter);
    res.json(r.value.invitation);
  }));

  router.post("/:id/cancel", wrap(async (req, res) => {
    const r = await deps.service.cancel(inviterOf(res).companyId, String(req.params["id"]));
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    res.json(r.value);
  }));

  router.delete("/:id", wrap(async (req, res) => {
    const r = await deps.service.cancel(inviterOf(res).companyId, String(req.params["id"]));
    if (!r.ok) return sendError(res, statusFor(r.code), r.code, r.detail);
    res.status(204).end();
  }));

  return router;
}
