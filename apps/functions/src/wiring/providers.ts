/**
 * @file providers.ts
 * @module apps/functions/src/wiring
 *
 * PFL-169 — builds every external-service dependency from the explicit
 * provider selection in loadConfig(). No silent fallbacks: a stub is used
 * only when its *_PROVIDER=stub was chosen.
 */

import * as crypto from "node:crypto";

import type { AnchorProvider, Hex32 } from "@proofline/anchoring";
import type { EmailProvider } from "@proofline/email";
import { makeResendProvider } from "@proofline/email/resend";
import { makeStubEmailProvider } from "@proofline/email/stub";

import type { AppConfig } from "../config/config.js";
import type {
  AnchorProvider as OnboardingAnchorProvider,
  KmsProvider,
  RegistryEvent,
} from "../api/onboarding/finalize.handler.js";
import type { OnboardingRouterDeps } from "../api/onboarding/router.js";
import { makeRealKmsProvider } from "./gcp-kms-provider.js";
import { stubKmsProvider, stubKybProvider, stubStripeIdentityProvider } from "./stubs.js";

// ─── Email ───────────────────────────────────────────────────────────────────

export function makeEmailProvider(config: Pick<AppConfig, "providers" | "email">): EmailProvider {
  if (config.providers.email === "stub") return makeStubEmailProvider();
  if (!config.email?.apiKey || !config.email.fromDomain) {
    throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY and RESEND_FROM_DOMAIN");
  }
  return makeResendProvider({ apiKey: config.email.apiKey, fromDomain: config.email.fromDomain });
}

// ─── KMS ─────────────────────────────────────────────────────────────────────

export function makeKmsProvider(config: Pick<AppConfig, "providers" | "kms">): KmsProvider {
  if (config.providers.kms === "stub") return stubKmsProvider;
  if (!config.kms?.projectId || !config.kms.keyRing) {
    throw new Error("KMS_PROVIDER=gcp requires a project and KMS_KEYRING");
  }
  return makeRealKmsProvider(config.kms);
}

// ─── Onboarding anchor ───────────────────────────────────────────────────────
//
// Finalize anchors the new company's registry events. Each event becomes a
// 32-byte leaf (sha256 of its JSON) and the shared AnchorProvider builds the
// Merkle root and posts it — the same provider the batch scheduler uses.

function leafFor(event: RegistryEvent): Hex32 {
  const digest = crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return `0x${digest}` as Hex32;
}

export function makeOnboardingAnchorProvider(anchor: AnchorProvider): OnboardingAnchorProvider {
  return {
    buildTree(events: RegistryEvent[]) {
      return { root: anchor.buildTree(events.map(leafFor)).root };
    },
    async postAnchor(root: string) {
      const receipt = await anchor.postAnchor(root as Hex32);
      return { txHash: receipt.txHash, blockNumber: Number(receipt.blockNumber) };
    },
  };
}

// ─── Onboarding deps ─────────────────────────────────────────────────────────

export function makeOnboardingDeps(
  config: AppConfig,
  deps: { email: EmailProvider; anchor: AnchorProvider },
): OnboardingRouterDeps {
  return {
    sendVerificationCode:   (to, code) => deps.email.sendVerificationCode(to, code),
    // KYB / IDV: loadConfig only accepts "stub" until PFL-162 wires the
    // Baselayer / Cobalt / Stripe Identity adapters.
    kybProvider:            stubKybProvider,
    stripeIdentityProvider: stubStripeIdentityProvider,
    kmsProvider:            makeKmsProvider(config),
    anchorProvider:         makeOnboardingAnchorProvider(deps.anchor),
  };
}
