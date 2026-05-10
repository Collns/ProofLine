/**
 * @file manual.ts
 * @module apps/functions/src/anchoring
 *
 * POST /v1/admin/anchor/run
 *
 * Triggers an immediate anchor batch outside the 5-minute schedule.
 * Reuses the SAME runAnchorBatchOnce code path as scheduler.ts so the
 * two cannot drift.
 *
 * Use cases:
 *   1. Demo prep — pre-anchor demo fixture data 30 min before the demo
 *      (TDD §6.3 demo anti-failure plan).
 *   2. Live demo climax — "let me trigger an anchor right now."
 *
 * Auth (hackathon): hardcoded ALLOW.
 *   TODO(post-hackathon): require admin role + WebAuthn fresh assertion
 *   per PRD §6.8 F-ADM-03 sensitive actions.
 */

import * as express from "express";

import { runAnchorBatchOnce } from "./run-batch.js";
import type { RunAnchorDeps } from "./run-batch.js";
import { makeRFC7807Error } from "../api/onboarding/http.helpers.js";

// ─── Response shape (documented contract) ─────────────────────────────────────

export type ManualAnchorResponse =
  | {
      ok:        true;
      message:   string;
      leafCount: 0;
    }
  | {
      ok:        true;
      recordId:  string;
      sequence:  number;
      root:      string;
      txHash:    string;
      leafCount: number;
    }
  | {
      ok:    false;
      error: { code: string; detail?: string };
    };

// ─── Handler ──────────────────────────────────────────────────────────────────

export function makeManualAnchorHandler(deps: RunAnchorDeps) {
  return async function manualAnchorHandler(
    _req: express.Request,
    res:  express.Response,
  ): Promise<void> {
    let result;
    try {
      result = await runAnchorBatchOnce(deps);
    } catch (err) {
      const detail = (err as Error).message;
      deps.logger.captureError(err as Error, {
        tags: { component: "manual-anchor", phase: "run-batch" },
      });
      res.status(500).json(
        makeRFC7807Error(
          "https://proofline.app/errors/ANCHOR_RUN_FAILED",
          "ANCHOR_RUN_FAILED",
          500,
          detail,
        ),
      );
      return;
    }

    if (result.kind === "empty") {
      const body: ManualAnchorResponse = {
        ok:        true,
        message:   "no events to anchor",
        leafCount: 0,
      };
      res.status(200).json(body);
      return;
    }

    if (result.kind === "failed") {
      const body: ManualAnchorResponse = {
        ok:    false,
        error: {
          code:   result.error.code,
          detail: "detail" in result.error ? result.error.detail : undefined,
        },
      };
      res.status(500).json(body);
      return;
    }

    // result.kind === "anchored"
    const body: ManualAnchorResponse = {
      ok:        true,
      recordId:  result.record.id,
      sequence:  result.record.sequence,
      root:      result.record.root,
      txHash:    result.record.txHash,
      leafCount: result.record.leafCount,
    };
    res.status(200).json(body);
  };
}

// ─── Router (mountable into apps/functions/src/index.ts) ──────────────────────

export function makeAnchorAdminRouter(deps: RunAnchorDeps): express.Router {
  const router = (express as any).Router();
  router.post("/run", makeManualAnchorHandler(deps));
  return router;
}
