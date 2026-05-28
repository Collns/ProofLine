/**
 * @file start.handler.ts
 * @module apps/functions/src/api/onboarding
 *
 * POST /v1/onboard/start
 */

import * as express from "express";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";

import { ERR } from "./http.helpers.js";
import {
  generateDnsToken,
  getCompanyByDomain,
  CompanyDoc,
} from "./onboarding.helpers.js";

const StartRequestSchema = z.object({
  domain:     z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/, "domain must be lowercase alphanumeric"),
  legalName:  z.string().min(2).max(200),
  ein:        z.string().regex(/^\d{2}-\d{7}$/, "EIN must be formatted as XX-XXXXXXX"),
  state:      z.string().length(2).toUpperCase(),
  ownerEmail: z.string().email(),
  // PFL-105: the admin app has no Firebase Auth login yet, so the stub
  // auth middleware sets req.user.userId = "dev-user". The owner's REAL
  // Firebase UID (used by the extension) is passed in the body so the
  // company doc records the right owner — letting finalize seed the
  // owner's users/{realUID} doc and the extension pick up the real
  // companyId. TODO(PFL-105.1): replace with a verified ID token once
  // the admin app gains a real login.
  ownerUserId: z.string().min(1).optional(),
});

type StartRequest  = z.infer<typeof StartRequestSchema>;
type StartResponse = {
  companyId: string;
  domain:    string;
  dnsToken:  string;
  txtRecord: string;
  txtHost:   string;
};

export function makeStartHandler() {
  return async function startHandler(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    const parseResult = StartRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json(ERR.badRequest(parseResult.error.message));
      return;
    }

    const body: StartRequest = parseResult.data;
    const { userId: reqUserId } = (req as any).user as { userId: string; companyId: string };
    // Prefer the real owner UID from the body over the stub-auth userId.
    const userId = body.ownerUserId ?? reqUserId;

    const existing = await getCompanyByDomain(body.domain);
    if (existing && existing.onboardingStatus === "verified") {
      res.status(409).json(
        ERR.conflict("DOMAIN_ALREADY_VERIFIED", `Domain ${body.domain} is already onboarded`)
      );
      return;
    }

    const companyId = existing?.companyId ?? uuidv7();
    const dnsToken  = generateDnsToken();
    const now       = Date.now();

    const firestore = getFirestore();

    const doc: CompanyDoc = {
      companyId,
      domain:           body.domain.toLowerCase().trim(),
      legalName:        body.legalName,
      ein:              body.ein,
      state:            body.state,
      ownerUserId:      userId,
      ownerEmail:       body.ownerEmail,
      onboardingStatus: "pending_dns",
      dnsToken,
      createdAt:        existing?.createdAt ?? now,
      updatedAt:        now,
    };

    await firestore.collection("companies").doc(companyId).set(doc, { merge: false });

    const response: StartResponse = {
      companyId,
      domain:    body.domain,
      dnsToken,
      txtRecord: `proofline-verify=${dnsToken}`,
      txtHost:   `_proofline.${body.domain}`,
    };

    res.status(201).json(response);
  };
}