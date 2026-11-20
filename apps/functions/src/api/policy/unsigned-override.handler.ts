/**
 * @file unsigned-override.handler.ts
 * @module apps/functions/src/api/policy
 *
 * POST /v1/extension/unsigned-override  (PFL-188)
 *
 * Records a "send unsigned" override for the admin audit log. Auth: the
 * extension JWS Bearer (requireExtensionAuth sets req.user). The user and
 * company are taken from the token, never the body.
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR } from "../onboarding/http.helpers.js";

const BodySchema = z.object({
  recipientSetHash: z.string().max(200).optional(),
  composeType:      z.string().max(40).optional(),
  policyMode:       z.string().max(40).optional(),
});

export function makeUnsignedOverrideHandler(deps: { now?: () => number } = {}) {
  const now = deps.now ?? (() => Date.now());
  return async function unsignedOverrideHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const user = (req as express.Request & { user?: { userId?: string; companyId?: string } }).user;
    if (!user?.userId || !user.companyId) {
      res.status(401).json(ERR.unauthorized("Extension auth with a company is required"));
      return;
    }
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const ts = now();
    await getFirestore().collection("audit_events").add({
      type:             "UNSIGNED_SEND_OVERRIDE",
      actorUserId:      user.userId,
      companyId:        user.companyId,
      recipientSetHash: parsed.data.recipientSetHash ?? "",
      composeType:      parsed.data.composeType ?? "unknown",
      policyAtTime:     parsed.data.policyMode ?? "unknown",
      createdAt:        ts,
    });
    res.status(200).json({ ok: true });
  };
}
