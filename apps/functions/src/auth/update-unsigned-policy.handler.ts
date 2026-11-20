/**
 * @file update-unsigned-policy.handler.ts
 * @module apps/functions/src/auth
 *
 * POST /v1/admin/update-unsigned-policy — PFL-188.
 *
 * Owner/manager only: set the company's unsigned-email policy
 * (companies/{companyId}.unsignedEmailPolicy). Wires are always blocked
 * unsigned regardless of this setting.
 *
 * Auth: `Authorization: Bearer <firebaseIdToken>`. Caller must be an active
 * owner or manager; the company is taken from the caller's own user doc,
 * never the body. The change is mirrored to `audit_events`.
 */

import type * as express from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

import { ERR, makeRFC7807Error } from "../api/onboarding/http.helpers.js";

const BodySchema = z.object({
  mode: z.enum(["block", "warn", "allow"], {
    errorMap: () => ({ message: "mode must be block, warn or allow" }),
  }),
  allowUnsignedOverride: z.boolean(),
});

const ADMIN_ROLES = new Set(["owner", "manager"]);

export interface UpdateUnsignedPolicyResponse {
  ok: true;
  companyId: string;
  policy: { mode: "block" | "warn" | "allow"; allowUnsignedOverride: boolean };
}

export interface UpdateUnsignedPolicyDeps {
  verifyIdToken?: (idToken: string) => Promise<{ uid: string; email?: string }>;
  now?: () => number;
}

export function makeUpdateUnsignedPolicyHandler(deps: UpdateUnsignedPolicyDeps = {}) {
  const verifyIdToken =
    deps.verifyIdToken ??
    (async (idToken: string) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    });
  const now = deps.now ?? (() => Date.now());

  return async function updateUnsignedPolicyHandler(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json(ERR.unauthorized("Missing or malformed Authorization header"));
      return;
    }
    let caller: { uid: string; email?: string };
    try {
      caller = await verifyIdToken(authHeader.slice("Bearer ".length).trim());
    } catch (err) {
      res.status(401).json(ERR.unauthorized(err instanceof Error ? err.message : "ID token verification failed"));
      return;
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(ERR.badRequest(parsed.error.message));
      return;
    }
    const { mode, allowUnsignedOverride } = parsed.data;

    const firestore = getFirestore();
    const callerSnap = await firestore.collection("users").doc(caller.uid).get();
    if (!callerSnap.exists) {
      res.status(403).json(ERR.forbidden("Caller has no user record"));
      return;
    }
    const callerDoc = callerSnap.data() as { companyId?: string; role?: string; status?: string };
    if (!callerDoc.companyId) {
      res.status(403).json(ERR.forbidden("Caller is not linked to a company"));
      return;
    }
    if (callerDoc.status && callerDoc.status !== "active") {
      res.status(403).json(ERR.forbidden(`Caller is ${callerDoc.status}`));
      return;
    }
    if (!callerDoc.role || !ADMIN_ROLES.has(callerDoc.role)) {
      res.status(403).json(
        makeRFC7807Error(
          "https://proofline.app/errors/NOT_AUTHORIZED",
          "NOT_AUTHORIZED",
          403,
          "Only an owner or manager can change the company signing policy",
        ),
      );
      return;
    }

    const ts = now();
    const policy = { mode, allowUnsignedOverride };
    await firestore.collection("companies").doc(callerDoc.companyId).set(
      { unsignedEmailPolicy: policy, updatedAt: ts },
      { merge: true },
    );

    try {
      await firestore.collection("audit_events").add({
        type:        "UNSIGNED_POLICY_UPDATED",
        actorUserId: caller.uid,
        companyId:   callerDoc.companyId,
        mode,
        allowUnsignedOverride,
        createdAt:   ts,
      });
    } catch (err) {
      console.warn(`[update-unsigned-policy] audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const response: UpdateUnsignedPolicyResponse = { ok: true, companyId: callerDoc.companyId, policy };
    res.status(200).json(response);
  };
}
