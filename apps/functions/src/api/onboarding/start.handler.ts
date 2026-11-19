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
  // Optional, but Baselayer needs at least a city for its address match.
  street:     z.string().trim().max(200).optional(),
  city:       z.string().trim().max(100).optional(),
  zip:        z.string().trim().regex(/^\d{5}(-\d{4})?$/, "zip must be a US ZIP code").optional(),
  website:    z.string().trim().max(253).optional(),
  // The owner is always the authenticated caller (Firebase ID token,
  // PFL-166). Any ownerUserId in the body is stripped by zod and ignored.
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
    const userId = (req as express.Request & { user?: { userId?: string } }).user?.userId;
    if (!userId) {
      res.status(401).json(ERR.unauthorized());
      return;
    }

    const existing = await getCompanyByDomain(body.domain);
    if (existing && existing.onboardingStatus === "verified") {
      res.status(409).json(
        ERR.conflict("DOMAIN_ALREADY_VERIFIED", `Domain ${body.domain} is already onboarded`)
      );
      return;
    }
    // Another owner who has already proven DNS control keeps the domain;
    // a restart by someone else would reset their progress.
    if (existing && existing.ownerUserId !== userId && existing.dnsVerifiedAt) {
      res.status(409).json(
        ERR.conflict(
          "DOMAIN_IN_PROGRESS",
          `Domain ${body.domain} is being onboarded by another account`,
        )
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
      ...(body.street || body.city || body.zip
        ? { address: {
            ...(body.street ? { street: body.street } : {}),
            ...(body.city   ? { city:   body.city }   : {}),
            ...(body.zip    ? { zip:    body.zip }    : {}),
          } }
        : {}),
      ...(body.website ? { website: body.website } : {}),
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