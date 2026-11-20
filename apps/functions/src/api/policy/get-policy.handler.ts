/**
 * @file get-policy.handler.ts
 * @module apps/functions/src/api/policy
 *
 * GET /v1/extension/policy  (PFL-188)
 *
 * Returns the caller company's unsigned-email policy for the extension to
 * cache. Auth: the extension JWS Bearer (requireExtensionAuth sets req.user).
 * The extension fails CLOSED on any error, so an absent company doc still
 * returns the locked default (block + override).
 */

import type * as express from "express";
import { getFirestore } from "firebase-admin/firestore";

import { ERR } from "../onboarding/http.helpers.js";
import { readUnsignedPolicy } from "./policy.helpers.js";

export function makeGetPolicyHandler() {
  return async function getPolicyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const user = (req as express.Request & { user?: { companyId?: string } }).user;
    if (!user?.companyId) {
      res.status(401).json(ERR.unauthorized("Extension auth with a company is required"));
      return;
    }
    const snap = await getFirestore().collection("companies").doc(user.companyId).get();
    const policy = readUnsignedPolicy(snap.exists ? (snap.data() ?? null) : null);
    res.status(200).json({ ok: true, policy });
  };
}
