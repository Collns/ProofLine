# ProofLine Codebase Audit Report

**Date:** 2026-05-11
**Commit:** `2725194e54c04b5720e8dee92e0c6d9a0c7b296d` (HEAD on `main`)
**Working tree:** 6 modified files (uncommitted) — API base URL changes pointing the four web apps + extension at the deployed Functions origin
**Scope:** Read-only audit. No source files modified.

---

## 0. Executive Summary

The repo is a pnpm monorepo split into **7 apps** and **19 packages**, with a Solidity anchor contract and Firebase Hosting + Functions deployment. Total source: ~55 test files, **460 tests passing across 17 suites**, with one app failing `tsc --noEmit`.

The **core cryptographic + verification primitives are real and well-tested**: canonical, crypto, anchoring (Merkle + Base Sepolia), webauthn, sessions, policy, verification, email banner, kyb, onboarding service, observability. The **public verify endpoint is the only fully wired end-to-end surface** (Hosting → Functions → Firestore → on-chain). Every other web surface still defaults to **fixture mode** in production.

7 of the 19 packages listed in the PRD architecture are **`export {}` scaffolds with empty providers/ dirs**: `ai`, `audit`, `bilateral`, `invitations`, `kms`, `registry`, `ui`. Their absence is hidden by the policy/onboarding/verification code re-implementing what they would own (audit logging is inline, KMS lives inside onboarding, registry views are inline in functions/verify).

The Firebase Functions deploy ships only three exports — `api` (verify), `anchorAdmin`, `anchorBatchScheduler` — even though `/v1/onboard/*` and `/v1/sign*` handler code is complete and tested. The handlers exist as code only; they are not mounted in `apps/functions/src/index.ts`.

**Critical gaps for hackathon demo:**
1. `/v1/sign`, `/v1/sign-silent`, `/v1/sign/finalize` not exposed (extension cannot actually sign anything against live backend).
2. `/v1/onboard/*` not exposed (web-admin runs entirely on hardcoded fixtures).
3. `/v1/cosign/*` not implemented server-side (web-counterparty returns 404 in live mode).
4. `web-counterparty` typecheck fails (2 errors).
5. `.env.local` is gitignored (good) but secrets in it (Stripe, Resend, Gemini, deployer key) are real and active.

---

## 1. Repository Structure

```
proofline/
├── apps/                7 apps
│   ├── design-prototype/   Vite + React 19, visual reference only, not in main build chain
│   ├── extension-chrome/   Manifest v3, esbuild bundle, 19 src files, 9 test files
│   ├── functions/          Firebase Functions, esbuild bundle, 33 src files, 8 test files
│   ├── web-admin/          Onboarding wizard + invitations dashboard, 45 src files, 2 test files
│   ├── web-counterparty/   Cosign deep-link portal, 22 src files, 3 test files
│   ├── web-sign/           WebAuthn popup ceremony surface, 17 src files, 3 test files
│   └── web-verify/         Public verify page, 18 src files, 0 test files
│
├── packages/            19 packages (12 real, 7 scaffolds)
│   ├── REAL (1500–60 LoC each):
│   │   anchoring (329 LoC, 1 test) — Merkle tree + Base Sepolia viem provider
│   │   canonical (60 LoC, 1 test)  — RFC 8785 JCS, used by sign + verify
│   │   crypto (173 LoC, 2 tests)   — SHA-256, P-256 verify, GCP-KMS provider, stub
│   │   email (952 LoC, 3 tests)    — banner renderer (3 states), Resend provider, stub
│   │   kyb (942 LoC, 2 tests)      — Middesk + stub providers
│   │   observability (389 LoC, 2)  — Sentry + stub providers + sanitizer
│   │   onboarding (1564 LoC, 2)    — 6-step service (DNS, email, KYB, KYC, finalize)
│   │   policy (879 LoC, 1 test)    — ALWAYS-ON validation pipeline (F-SIG-11)
│   │   sessions (1561 LoC, 4)      — per-recipient sliding TTL, JWS tokens, silent-sign
│   │   types (513 LoC, 6 tests)    — zod schemas for envelope/email/session/wire
│   │   verification (1547 LoC, 4)  — 4-state verification algorithm
│   │   webauthn (879 LoC, 2)       — @simplewebauthn server + browser helpers
│   │
│   └── SCAFFOLD-ONLY (single `export {};`):
│       ai, audit, bilateral, invitations, kms, registry, ui
│
├── contracts/           Foundry, Anchor.sol deployed on Base Sepolia
├── docs/                PRD (1124 lines), TDD (1618), ARCHITECTURE (47), SETUP (73), adr/ (EMPTY)
├── firebase.json        4 hosting targets + 1 functions codebase
└── .firebaserc          project: proofline-cdabb
```

**Doc gaps:** `docs/adr/` is empty save for `.gitkeep`. PRD and TDD reference **ADR-0001 through ADR-0014** but none exist on disk. `PROJECT_OVERVIEW.md` referenced in PRD §1 doesn't exist.

---

## 2. Package Health

| Package | Status | src files | tests | LoC | Importers (apps/pkgs) |
|---|---|---:|---:|---:|---|
| `@proofline/anchoring` | ✅ Real | 4 | 1 (10 cases) | 329 | functions, onboarding |
| `@proofline/canonical` | ✅ Real | 1 | 1 (19 cases) | 60 | extension, functions, web-counterparty, web-sign |
| `@proofline/crypto` | ✅ Real | 7 | 2 (8 cases) | 173 | verification, anchoring, webauthn (transitive) |
| `@proofline/email` | ✅ Real | 8 | 3 (29 cases) | 952 | functions (banner), onboarding (Resend) |
| `@proofline/kyb` | ✅ Real | 4 | 2 (20 cases) | 942 | onboarding |
| `@proofline/observability` | ✅ Real | 5 | 2 (18 cases) | 389 | (not wired into functions runtime yet) |
| `@proofline/onboarding` | ✅ Real | 12 | 2 (29 cases) | 1564 | functions (router code only — not mounted) |
| `@proofline/policy` | ✅ Real | 4 | 1 (23 cases) | 879 | functions, sessions |
| `@proofline/sessions` | ✅ Real | 7 | 4 (37 cases) | 1561 | functions (sign helpers), web-sign (dep declared) |
| `@proofline/types` | ✅ Real | 8 | 6 (28 cases) | 513 | every app + verification |
| `@proofline/verification` | ✅ Real | 6 | 4 (32 cases) | 1547 | functions/verify, web-counterparty, web-verify |
| `@proofline/webauthn` | ✅ Real | 5 | 2 (19 cases) | 879 | functions (sign helpers), web-admin, web-counterparty, web-sign |
| `@proofline/ai` | ❌ Scaffold | 1 | 0 | 1 | none |
| `@proofline/audit` | ❌ Scaffold | 1 | 0 | 1 | none |
| `@proofline/bilateral` | ❌ Scaffold | 1 | 0 | 1 | none |
| `@proofline/invitations` | ❌ Scaffold | 1 | 0 | 1 | none (comment only in web-admin/api/invitations-types.ts) |
| `@proofline/kms` | ❌ Scaffold | 1 | 0 | 1 | none (KMS adapter lives inline in onboarding finalize step instead) |
| `@proofline/registry` | ❌ Scaffold | 1 | 0 | 1 | none (RegistryView lives inline in functions/verify and verification package) |
| `@proofline/ui` | ❌ Scaffold | 1 | 0 | 1 | declared in web-verify, web-counterparty, web-sign package.json — but no actual imports |

**Note:** All 7 scaffold packages export `{}` with empty `providers/.gitkeep` dirs. They appear in `pnpm-workspace.yaml`, build cleanly (TypeScript happily compiles `export {}`), and pass tests (vitest `--passWithNoTests`). They are dead weight but not broken.

---

## 3. App Health

| App | Status | Build | Typecheck | Tests | Deployed URL |
|---|---|---|---|---:|---|
| `apps/functions` | ✅ Healthy | ✅ esbuild bundles to 829 KB | ✅ | 75 / 75 | `https://us-central1-proofline-cdabb.cloudfunctions.net/{api,anchorAdmin,anchorBatchScheduler}` |
| `apps/web-verify` | 🟡 Live-wired, no tests | ✅ 260 KB JS | ✅ | 0 | `https://proofline-verify.web.app` |
| `apps/web-sign` | 🟡 Live-wired, blocked by missing endpoints | ✅ 259 KB JS | ✅ | 16 / 16 | `https://proofline-sign.web.app` |
| `apps/web-counterparty` | 🟡 Live-wired, blocked + typecheck fails | ✅ 261 KB JS (build OK) | ❌ **2 errors** | 19 / 19 | `https://proofline-counterparty.web.app` |
| `apps/web-admin` | 🟡 Fixture-only (`isFixtureMode()` hardcoded `return true`) | ✅ 331 KB JS | ✅ | 12 / 12 | `https://proofline-admin.web.app` |
| `apps/extension-chrome` | 🟡 Code complete, blocked by missing /v1/sign* | ✅ esbuild | ✅ | 66 / 66 | unpacked, not on Chrome Web Store |
| `apps/design-prototype` | 🟦 Reference only | (no `build` in monorepo) | (no `typecheck` script) | n/a | not deployed |

### App route/endpoint inventory

**`functions`** (the only thing actually serving HTTP):
- `GET  /v1/verify/:id` — public, no auth — F-VER-01 / PFL-023
- `GET  /healthz` — liveness
- `POST /v1/admin/anchor/run` — anchor batch manual trigger
- (Cloud scheduler) `anchorBatchScheduler` — every 5 minutes
- **NOT EXPOSED but coded:** `/v1/onboard/{start,verify-dns,verify-email,verify-email-code,kyb,enroll-officer,finalize}`, `/v1/sign`, `/v1/sign-silent`, `/v1/sign/finalize`

**`web-admin`** routes:
- `/` DashboardHome, `/onboarding` OnboardingWizard (9 steps), `/invitations` + `/invitations/:id` + `/invitations/new`, `/demo` DemoHub
- API client hardcoded `isFixtureMode() = return true`

**`web-verify`** routes:
- `/v/:id` VerifyPage, `/v/:id/bilateral` BilateralPage, `/unverified-sender`, `*` NotFound
- API client: **defaults to fixture mode** unless `mode: 'live'` passed in opts

**`web-counterparty`** routes:
- `/cosign/:messageId` CosignLanding + `…/success` + `…/expired` + `…/fresh-link`
- API client: default `'fixtures'` (hard-coded — even DEV check is bypassed at line 32)
- Live mode points at `/v1/cosign/*` which **does not exist server-side**

**`web-sign`** routes:
- `/extension/auth`, `/sign/start`, `/sign/silent`, `*` NotFound
- Calls `/v1/sign`, `/v1/sign-silent`, `/v1/sign/finalize`, `/v1/extension/auth` — none deployed

**`extension-chrome`** background flow:
- content/inject-toolbar → background/index → api-client → `${CONFIG.apiOrigin}/v1/sign*`
- Calls `/v1/sign`, `/v1/sign-silent`, `/v1/sign/finalize` — none deployed

---

## 4. Feature Coverage (PRD mapping)

Legend: ✅ shipped (code + tests, deployed or deployable) · 🟡 partial (code exists but not wired or not complete) · ❌ not started · ⏭️ deferred per PRD

### §6.1 Onboarding & Identity Verification

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-ON-01 | DNS TXT domain control | 🟡 | `packages/onboarding/src/steps/verify-dns.ts` + `apps/functions/src/api/onboarding/verify-dns.handler.ts` (handler not mounted) |
| F-ON-02 | Email codes via Resend to admin@ + postmaster@ | 🟡 | `packages/onboarding/src/steps/verify-email.ts` + Resend provider in `packages/email/src/providers/resend.ts` (handler not mounted) |
| F-ON-03 | Middesk KYB | 🟡 | `packages/kyb/src/providers/middesk.ts` + onboarding kyb step (handler not mounted) |
| F-ON-04 | Stripe Identity officer KYC | 🟡 | `packages/onboarding/src/steps/kyc.ts` + `apps/functions/src/api/onboarding/enroll-officer.handler.ts` (handler not mounted) |
| F-ON-05 | Cloud KMS provisions P-256 root key | 🟡 | `packages/crypto/src/providers/gcp-kms.ts` + `packages/onboarding/src/steps/finalize.ts` calls KMS (handler not mounted) |
| F-ON-06 | Anchor on Base Sepolia | ✅ | Contract deployed (0x079D…d7D0), `apps/functions/src/anchoring/*` runs scheduler + admin trigger |
| F-ON-07 | Manual review queue for flagged onboardings | ❌ | No admin UI; KYB returns flags but no review surface |
| F-ON-08 | Streamlined counterparty onboarding tier | ❌ | No distinct streamlined flow in code |

### §6.2 Identity & Access Management

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-IAM-01 | Three roles: owner/manager/employee | 🟡 | `packages/types/src/role-credential.ts` defines role union; policy checks roles |
| F-IAM-02 | WebAuthn passkey enrollment | 🟡 | `packages/webauthn/src/server.ts` (4 fns), `apps/web-admin/src/lib/webauthn-bridge.ts` (browser side scaffold) — finalize handler not mounted; admin UI uses fixtures |
| F-IAM-03 | Per-role authority limits | ✅ | `packages/policy/src/pipeline.ts` validates per-email + daily aggregate |
| F-IAM-04 | Device revocation | ❌ | No revocation handler/UI |
| F-IAM-05 | Revocations propagate to registry within 5s | ❌ | Not implemented |
| F-IAM-06 | M-of-N guardian social recovery | ⏭️ | PRD says P2 |

### §6.3 Email Signing

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-SIG-01 | Sign canonical email payload (subject/body/recipients/threadId/timestamp/nonce) | 🟡 | `packages/canonical/src/index.ts`, `packages/types/src/email.ts` (zod), extension `extract-payload.ts` + `canonical-bridge.ts`, `apps/functions/src/signing/handlers/sign.handler.ts` (handler not mounted) |
| F-SIG-02 | 24h validity + nonce | ✅ | `EmailPayload` schema includes `issuedAt`, `expiresAt`, `nonce`; policy enforces freshness |
| F-SIG-03 | Single-sig within authority | ✅ | `packages/policy/src/pipeline.ts` |
| F-SIG-04 | Cosign over per-email or daily aggregate limits | 🟡 | Policy returns `COSIGN_REQUIRED`; cosign EMAIL delivery via Resend not wired; portal exists |
| F-SIG-05 | Approver biometric over same canonical payload | 🟡 | `apps/web-counterparty` cosign surface code complete; backend `/v1/cosign/*` missing |
| F-SIG-06 | Gemini screening for wire instruction memo | ❌ | `packages/ai` is a scaffold — `export {}` |
| F-SIG-07 | Signed envelopes immutable + audit log append-only | 🟡 | Firestore rules deny all client writes; audit log package is scaffold |
| F-SIG-08 | Cosign JWS link with `exp` | 🟡 | Sessions JWS infrastructure exists in `packages/sessions/src/tokens.ts`; cosign-specific token issuer not implemented |
| F-SIG-09 | Re-fetch + re-verify before biometric | ✅ | `apps/web-counterparty/src/lib/verify-checklist.ts` runs 6-step pre-biometric check |
| F-SIG-10 | Refuse expired/replayed cosign link, offer fresh-link | 🟡 | UI exists (`CosignFreshLink.tsx`); server endpoint absent |
| F-SIG-11 | ALWAYS-ON full policy pipeline server-side | ✅ | `packages/policy/src/pipeline.ts` is fully tested (23 cases); all three sign handlers call `validatePolicy` |

### §6.4 Per-Recipient Signing Sessions

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-SES-01 | Session opens on successful fresh WebAuthn ceremony | ✅ (code) | `packages/sessions/src/service.ts` + `apps/functions/src/signing/handlers/signing.helpers.ts#createSession` |
| F-SES-02 | 15min sliding / 60min hard cap | ✅ (code) | `packages/sessions/src/service.ts` defaults |
| F-SES-03 | Silent WebAuthn within active session | ✅ (code) | `packages/sessions/src/silent-sign.ts`, sign-silent.handler.ts |
| F-SES-04 | Server-side session record; extension holds JWS | ✅ (code) | Firestore `sessions/{sessionId}`; `chrome.storage.local` in extension `session-store.ts` |
| F-SES-05 | Recipient-set hash scoping | ✅ | `packages/sessions/src/recipient-set.ts` (5 tests) |
| F-SES-06 | Auto-revoke conditions | 🟡 | Service supports revoke; many trigger conditions (device revoke, role change, deactivate) require admin UI not built |
| F-SES-07 | High-value bypass to fresh biometric | ✅ (code) | Policy + silent-sign handler enforces |
| F-SES-08 | Cosign always fresh biometric | ✅ (code) | sign-finalize.handler.ts path differentiation |

**All F-SES-* logic exists and is tested (37 cases in sessions/, 21 in signing.integration), but the sign handlers are not mounted in the deployed Function.**

### §6.5 Verification

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-VER-01 | 4-state verify page | ✅ | `apps/web-verify/src/routes/VerifyPage.tsx` + verification package |
| F-VER-02 | Show signed details + signer identities | ✅ | `apps/web-verify/src/components/{PayloadCard,SignerList}.tsx` |
| F-VER-03 | On-chain anchor block + tx + Basescan link | ✅ | `AnchorReceipt.tsx` + `lib/basescan.ts` |
| F-VER-04 | Programmatic verify API | ✅ | `GET /v1/verify/:id` deployed |
| F-VER-05 | Mobile-first | 🟡 | Tailwind responsive classes present; no real mobile QA evidence |
| F-VER-06 | "Unverified sender" page | ✅ | `apps/web-verify/src/routes/UnverifiedSenderPage.tsx`; function returns `unverified_sender` state |
| F-VER-07 | SUSPECTED_SPOOF state | ✅ | `apps/functions/src/verify/unverified-sender.ts` + `packages/verification/src/__tests__/verify-suspected-spoof.test.ts` |
| F-VER-08 | Sender-side inline HTML banner | ✅ | `packages/email/src/banner/render.ts` (3 states, table-based, inline-styled, 29 tests across renderer+escape) |
| F-VER-09 | Recipient-side in-Gmail badge | 🟡 | `apps/extension-chrome/src/content/inject-banner.ts` exists but recipient detection path not exercised |
| F-VER-10 | Outlook | ⏭️ | P2/v2 per PRD |

### §6.6 Bilateral Documents

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-BIL-01 | Draft bilateral document in counterparty portal | ❌ | No drafting UI; `@proofline/bilateral` is a scaffold |
| F-BIL-02 | Drafter signs over canonical payload | ❌ | Not implemented |
| F-BIL-03 | Counterparty receives signed link + reviews | 🟡 | Cosign deep-link path covers the review UI for wires; bilateral docs not separately implemented |
| F-BIL-04 | Counterparty signs same canonical bytes → BILATERAL_SIGNED | ❌ | Not implemented |
| F-BIL-05 | Both sigs bound to same payload hash | 🟡 | Type `BilateralPayload` exists in `packages/types/src/bilateral.ts`; no service logic |
| F-BIL-06 | Configurable expiry | ❌ | Not implemented |
| F-BIL-07 | Revocation before counter-sign | ❌ | Not implemented |
| F-BIL-08 | Bilateral anchored on-chain | 🟡 | Anchor machinery generic — anything written to a Firestore collection queued by `apps/functions/src/anchoring/*` gets anchored |
| F-BIL-09 | Status webhook | ❌ | Not implemented |
| F-BIL-10 / F-BIL-11 | Extension surfaces | ⏭️ | Deferred to v1.1 per PRD |

### §6.7 Invitations

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-INV-01 | Invite counterparty by email | 🟡 | `apps/web-admin/src/routes/invitations/*` fully built UI; client fixture-only; no server endpoint |
| F-INV-02 | Contextual messaging | 🟡 | UI supports custom messages (`InviteFormSingle.tsx`); fixture-only |
| F-INV-03 | Streamlined invitee onboarding | ❌ | No separate streamlined flow |
| F-INV-04 | Sponsored cost | ❌ | Not implemented |
| F-INV-05 | 30-day expiry | 🟡 | Type definition only |
| F-INV-06 | Bulk import (up to 100) | 🟡 | `apps/web-admin/src/components/BulkEmailParser.tsx` (7 tests) + bulk form UI; fixture-only |
| F-INV-07 | Network coverage dashboard | 🟡 | `apps/web-admin/src/components/NetworkCoverageMeter.tsx` fixture data only |
| F-INV-08 | Post-onboarding invite CTA | 🟡 | StepInstallExtension is final step; no explicit "invite counterparties" CTA wired in flow |
| F-INV-09 | Post-onboarding install-extension step | ✅ | `apps/web-admin/src/routes/steps/StepInstallExtension.tsx` |

### §6.8 Admin & Observability

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-ADM-01 | Owner dashboard | 🟡 | `apps/web-admin/src/routes/DashboardHome.tsx` exists; data is fixtures |
| F-ADM-02 | Export signed audit bundle | ❌ | No export |
| F-ADM-03 | Sensitive actions → structured audit events | 🟡 | Observability stub provider logs; `@proofline/audit` is a scaffold |
| F-ADM-04 | Per-tenant rate-limiting + anomaly detection | ❌ | No rate-limit middleware |
| F-ADM-05 | Errors reported to Sentry with trace ID | 🟡 | Sentry provider exists in `packages/observability/src/providers/sentry.ts`; not initialized in functions/index.ts |
| F-ADM-06 | Configurable cosign/bilateral TTLs | ⏭️ | P1, v1 hardcoded |
| F-ADM-07 | Session admin (view/revoke/configure TTL/threshold) | ⏭️ | P1, v1 hardcoded |

### §6.9 Chrome Extension

| ID | Requirement | Status | Path |
|---|---|---|---|
| F-EXT-01 | Manifest v3 + (Chrome Web Store distribution) | 🟡 | `apps/extension-chrome/manifest.json` MV3 OK; not yet on store |
| F-EXT-02 | "Sign with ProofLine" toolbar in Gmail compose | ✅ (code) | `content/inject-toolbar.ts` + `gmail-detector.ts` (66 tests) |
| F-EXT-03 | Extract canonical payload, sign, inject banner | ✅ (code, blocked on backend) | `extract-payload.ts` + `canonical-bridge.ts` + `inject-banner.ts` |
| F-EXT-04 | Active session status in toolbar | 🟡 | `background/session-store.ts`; toolbar UI doesn't read it yet |
| F-EXT-05 | Recipient-side verify badge | 🟡 | `inject-banner.ts` supports it; inbound detection path not exercised in deployed build |
| F-EXT-06 | "Mark as wire instruction" + wire fields | 🟡 | Manifest + types support it; toolbar UI is single-button |
| F-EXT-07 | `chrome.storage.local` for session + identity | ✅ | `background/session-store.ts` + `auth-token.ts` |
| F-EXT-08 | WebAuthn ceremony in popup at correct RP ID | ✅ | popup-launcher.ts opens `proofline-sign.web.app`; rpId matches |
| F-EXT-09 | Graceful degrade on Gmail DOM change | 🟡 | `gmail-detector.ts` has `findToolbarWithSelector` + `TOOLBAR_NOT_FOUND_MARKER`; no user-facing update notification |

---

## 5. Dead Code & Broken References

### 5.1 Scaffold packages (no consumers)
- `@proofline/ai` — 0 importers. PRD F-SIG-06 (Gemini scam detection) is the intended consumer; nothing written.
- `@proofline/audit` — 0 importers. F-ADM-03 audit-log writer is missing.
- `@proofline/bilateral` — 0 importers. §6.6 bilateral state machine missing.
- `@proofline/invitations` — 0 importers (only a comment mentions it in `web-admin/src/api/invitations-types.ts`).
- `@proofline/kms` — 0 importers. `packages/crypto/src/providers/gcp-kms.ts` substitutes.
- `@proofline/registry` — 0 importers. `RegistryView` type lives in `packages/verification/src/types.ts` instead.
- `@proofline/ui` — declared as dep in `web-verify`, `web-counterparty`, `web-sign` package.json but never `import`-ed.

### 5.2 Code with no live wiring (handlers complete but not mounted)
- `apps/functions/src/api/onboarding/router.ts` — `makeOnboardingRouter()` defined and tested (8 e2e tests pass), never mounted in `apps/functions/src/index.ts`.
- `apps/functions/src/signing/handlers/sign.handler.ts` — `makeSignHandler()` defined + integration-tested (21 cases), never mounted.
- `apps/functions/src/signing/handlers/sign-silent.handler.ts` — same.
- `apps/functions/src/signing/handlers/sign-finalize.handler.ts` — same.

`apps/functions/src/index.ts` lines 13–15 explicitly comment that these routers are "pending HTTP wiring (live as code only)."

### 5.3 Broken references
- **`apps/web-counterparty` typecheck failures:**
  - `src/api/client.ts:87` — `messageId` field included on a `FinalizeCosignResponse` failure branch where the discriminated union doesn't allow it.
  - `vite.config.ts:10` — `test` key not recognized; needs `defineConfig` import from `vitest/config` rather than `vite`.
- **Onboarding router not mounted** — see 5.2.
- **`apps/web-counterparty` calls `/v1/cosign/*`** — endpoint does not exist server-side. With current default `mode: 'fixtures'`, no actual 404s in prod, but live-mode override breaks immediately.
- **`apps/web-sign` calls `/v1/extension/auth`, `/v1/sign*`** — none deployed.
- **`docs/adr/`** — directory exists but contains only `.gitkeep`. PRD §1 references ADRs 0001–0014.

### 5.4 Apparent orphans (referenced but missing)
- `PROJECT_OVERVIEW.md` — referenced in PRD §1; doesn't exist.
- `GEMINI_REDESIGN_PROMPT.md` — referenced in PRD §1; doesn't exist.

---

## 6. Config Consistency

### 6.1 RP ID / origin alignment

The current code uses **`proofline-sign.web.app`** consistently for the deployed RP ID. There's tested-but-stale tooling using `proofline.web.app` (no subdomain) that is now historical.

| Location | RP ID | Status |
|---|---|---|
| `apps/extension-chrome/src/shared/config.ts` | `proofline-sign.web.app` | ✅ |
| `apps/web-sign/src/routes/SignStart.tsx:195` | `proofline-sign.web.app` | ✅ |
| `apps/web-sign/src/routes/SignSilent.tsx:163` | `proofline-sign.web.app` | ✅ |
| `apps/functions/src/signing/handlers/sign.handler.ts:135` | `proofline-sign.web.app` | ✅ |
| `apps/functions/src/signing/handlers/sign-silent.handler.ts:140` | `proofline-sign.web.app` | ✅ |
| `apps/functions/src/signing/handlers/sign-finalize.handler.ts:180` | `expectedOrigin: 'https://proofline-sign.web.app'` | ✅ |
| `apps/extension-chrome/manifest.json` `externally_connectable` | `https://proofline-sign.web.app/*` | ✅ |
| `packages/webauthn/src/__tests__/*` | `proofline.web.app` | 🟡 historical; tests are self-contained so this doesn't break runtime |
| `packages/webauthn/src/__tests__/challenges.test.ts:11` | `proofline.web.app` | 🟡 same |
| `apps/extension-chrome/src/background/popup-manager.ts:15` (comment) | `proofline.web.app` | 🟡 comment is stale (`proofline.web.app` referenced — actual origin is `proofline-sign.web.app`) |
| `apps/extension-chrome/src/shared/ceremony.types.ts:12` (comment) | `app.proofline.web.app` | 🟡 stale comment |

Verdict: **production RP ID is aligned**. Test fixtures and comments still reference the old hostname.

### 6.2 API base URL

Modified-but-uncommitted state on this branch has all consumers pointing at the deployed Function origin:

| App | API base | Notes |
|---|---|---|
| extension-chrome | `https://us-central1-proofline-cdabb.cloudfunctions.net/api` | ✅ matches deployed |
| web-sign | same default | ✅ |
| web-verify | same default | ✅ |
| web-counterparty | same default | ✅ |
| web-admin | hardcoded `'/v1/onboard'` + `'/v1/invitations'` + `isFixtureMode() = true` | 🟡 fixture-only by design; live wiring will break (relative paths require hosting rewrite that doesn't exist) |

### 6.3 Hosting site name alignment

Firebase Hosting targets in `firebase.json` and `.firebaserc`:

| Target | Site | App dist dir | Live URL |
|---|---|---|---|
| `admin` | `proofline-admin` | `apps/web-admin/dist` | `https://proofline-admin.web.app` |
| `verify` | `proofline-verify` | `apps/web-verify/dist` | `https://proofline-verify.web.app` |
| `counterparty` | `proofline-counterparty` | `apps/web-counterparty/dist` | `https://proofline-counterparty.web.app` |
| `sign` | `proofline-sign` | `apps/web-sign/dist` | `https://proofline-sign.web.app` |

All four are consistent; CORS allowlist in `apps/functions/src/index.ts:54-64` matches all four (`.web.app` + `.firebaseapp.com`).

### 6.4 Email banner URL — inconsistency
- `packages/email/src/banner.ts:57` hardcodes `VERIFY_BASE_URL = "https://verify.proofline.web.app"` — this is **NOT** the deployed verify URL (`proofline-verify.web.app`).
- Renderer in `packages/email/src/banner/render.ts` takes `verifyBaseUrl` as input; the constant is only used inside `banner.ts` (the older banner file). Verify whether functions/signing inject the correct URL or the stale constant.
- `packages/email/src/providers/resend.ts:90` hardcodes invitation deep-link to `https://app.proofline.web.app/invite/{token}` — that subdomain does not exist either.

---

## 7. Security Notes

### 7.1 Secrets

- **`.env.local` is gitignored** (verified `git ls-files .env.local` returns nothing; `.gitignore` covers `.env*.local`).
- However, **`.env.local` in the working directory contains live keys**:
  - Stripe Test secret key (`sk_test_…`)
  - Resend API key (`re_…`)
  - Gemini API key (`AIza…`)
  - Sentry DSN
  - **Base Sepolia deployer private key in plaintext** (controls the anchor contract owner; whoever holds it can permanently brick anchoring by anchoring rogue roots).
- No secret-shaped string found in tracked source files (verified by grepping the values).
- The deployer key is testnet only — exposure is reputational rather than financial, but it is the **owner** of the `Anchor.sol` contract.

### 7.2 Firestore rules

`firestore.rules` is conservative:
- `signed_messages/*` public read, no client writes
- `companies/*` public read, no client writes
- `sessions/*` auth-gated to `request.auth.token.companyId == resource.data.companyId`
- everything else auth-required, writes via Functions only

This is correct for the deployed verify endpoint and presumed deferred admin flows.

### 7.3 CORS

`apps/functions/src/index.ts` hand-rolls a tight allowlist for `anchorAdmin` (only the four web.app + four firebaseapp.com origins). The public verify router uses `Access-Control-Allow-Origin: *` deliberately — correct for an unauthenticated public-trust endpoint.

### 7.4 Build artifacts

`apps/functions/esbuild.config.mjs` promotes a small allowlist of env keys (BASE_SEPOLIA_RPC, DEPLOYER_PRIVATE_KEY, ANCHOR_CONTRACT_ADDRESS, ANCHOR_CHAIN_ID, FIREBASE_PROJECT_ID) into `dist/.env`. This excludes Stripe / Resend / Gemini keys from the deployed bundle. ✅ Correct posture.

### 7.5 Observability not initialized

`packages/observability/src/providers/sentry.ts` exists but `Sentry.init` is never called in `apps/functions/src/index.ts` — F-ADM-05 (errors reported to Sentry with trace ID) is not actually working in deployed function.

---

## 8. Deployment Status

### 8.1 Hosting (Firebase)

All four sites deployed under project `proofline-cdabb`:

```
https://proofline-admin.web.app
https://proofline-counterparty.web.app
https://proofline-sign.web.app
https://proofline-verify.web.app
```

`.firebase/` cache shows recent hosting deploys (May 11 timestamps). `web-sign` was added recently per commit `84a8312`.

### 8.2 Functions

Project `proofline-cdabb`, region `us-central1`, runtime nodejs20:

| Export | Type | URL / schedule |
|---|---|---|
| `api` | onRequest | `https://us-central1-proofline-cdabb.cloudfunctions.net/api` → `GET /v1/verify/:id`, `GET /healthz` |
| `anchorAdmin` | onRequest | `https://us-central1-proofline-cdabb.cloudfunctions.net/anchorAdmin` → `POST /v1/admin/anchor/run` |
| `anchorBatchScheduler` | onSchedule | Cron `every 5 minutes` UTC |

Latest deploy: commit `2725194` (most recent on `main`). Functions bundle 829 KB, runtime deps installed via npm in `dist/` for Firebase CLI introspection.

### 8.3 On-chain (Base Sepolia)

| Field | Value |
|---|---|
| Chain | Base Sepolia (id 84532) |
| Contract | `ProofLineAnchor` (`contracts/src/Anchor.sol`) |
| Address | `0x079D64345af444Bc4cd89a298A00f8E5e302d7D0` |
| Deploy block | 41312740 |
| Deploy tx | `0xfe9d4e1ef70b109bac72ba08633e12846f49e1fc661805f84d119cb7b4f40549` |
| RPC | `https://sepolia.base.org` |

Deployment receipt at `contracts/broadcast/Deploy.s.sol/84532/run-latest.json`.

### 8.4 Not yet deployed
- `apps/extension-chrome` — no Chrome Web Store listing; runs unpacked
- `apps/design-prototype` — local dev only

---

## 9. Test Summary

**Total: 460 tests across 17 suites — all passing.**

| Package / app | Tests passing | Test files |
|---|---:|---:|
| apps/functions | 75 | 8 |
| apps/extension-chrome | 66 | 9 |
| packages/sessions | 37 | 4 |
| packages/verification | 32 | 4 |
| packages/email | 29 | 3 |
| packages/onboarding | 29 | 2 |
| packages/types | 28 | 6 |
| packages/policy | 23 | 1 |
| packages/kyb | 20 | 2 |
| apps/web-counterparty | 19 | 3 |
| packages/canonical | 19 | 1 |
| packages/webauthn | 19 | 2 |
| packages/observability | 18 | 2 |
| apps/web-sign | 16 | 3 |
| apps/web-admin | 12 | 2 |
| packages/anchoring | 10 | 1 |
| packages/crypto | 8 | 2 |
| apps/web-verify | 0 | 0 |

Build status:
- All 12 real packages build cleanly via `tsc`.
- All 4 production web apps build via vite.
- Functions bundle compiles via esbuild.
- **`apps/web-counterparty` typecheck fails** (vitest still runs because vitest doesn't enforce `tsc --noEmit`, only its own transformer).

Contract tests: not invoked in this audit (Foundry is a separate runtime); `contracts/test/Anchor.t.sol` exists and was used at deploy time.

---

## 10. Recommended Next Steps

Priority order, anchored to the demo path (PRD §15.3):

### P0 — required for any live signing demo
1. **Mount signing handlers in `apps/functions/src/index.ts`** — `/v1/sign`, `/v1/sign-silent`, `/v1/sign/finalize`. The handlers (`makeSignHandler`, `makeSignSilentHandler`, `makeSignFinalizeHandler`) and tests already exist; this is a 10-line wiring change + new deploy.
2. **Mount onboarding router** — `app.use('/v1/onboard', makeOnboardingRouter(deps))`. Same shape as above. Then flip `web-admin/src/api/client.ts:isFixtureMode()` from hardcoded `true` to env-driven.
3. **Implement `/v1/extension/auth`** — currently the extension cannot mint a real auth token; the popup-driven flow exists in `web-sign/src/routes/ExtensionAuth.tsx` but the server endpoint is missing. Without this, every `/v1/sign*` call 401s.
4. **Fix `apps/web-counterparty` typecheck** — the two errors in `client.ts:87` (discriminated union) and `vite.config.ts:10` (vitest config import) block CI cleanliness.

### P1 — required for cosign demo path
5. **Implement `/v1/cosign/*`** — `getCosignContext` (GET), `finalizeCosign` (POST), `refreshLink` (POST). The portal UI is done; the server endpoint stubs need building atop the existing sessions + policy primitives.
6. **Wire Sentry init** in `apps/functions/src/index.ts` — F-ADM-05. Needs `SENTRY_DSN` env promotion and one call to `initSentry()` at module load.
7. **Stale-comment cleanup**: extension-chrome ceremony-types and popup-manager comments reference `proofline.web.app` / `app.proofline.web.app`. Update to `proofline-sign.web.app` to match the rest of the codebase.
8. **Email banner URL inconsistency**: `packages/email/src/banner.ts:57` hardcodes `verify.proofline.web.app` (not deployed). Either remove the constant in favor of the parametric `render.ts` path, or update to `proofline-verify.web.app`.

### P2 — cleanup
9. **Delete or implement scaffold packages**: `ai`, `audit`, `bilateral`, `invitations`, `kms`, `registry`, `ui`. Either (a) remove from `pnpm-workspace.yaml` and prune the empty dirs, or (b) commit to building them. Keeping seven `export {}` packages around adds noise to every `pnpm -r` invocation.
10. **Write ADRs**: `docs/adr/` is empty but PRD references ADR-0001 through ADR-0014. At minimum: ADR-0009 (cosign expiry), 0010 (mandatory re-verify), 0011 (email surface strategy), 0012 (extension primary), 0013 (per-recipient sessions), 0014 (always-on policy) — these are repeatedly cited and the decisions are encoded in the code already.
11. **Resolve the `.env.local` exposure risk** — even though it's gitignored, the deployer private key is in plaintext. Consider rotating the testnet deployer key and storing the new one only in 1Password.
12. **Add `apps/web-verify` tests** — the only deployed live surface and it has zero unit tests. The renderer logic (anchor receipt, badge state) deserves coverage to lock in the public-trust output.

---

## 11. Git History (last 20 commits)

```
2725194 feat(functions): deploy Firebase Functions with esbuild bundle
3119a6b fix(extension+web-sign): fix NO_OPENER auth popup, persist credentialId on auth_success
5cd7884 fix(extension): wire getOrIssueAuthToken into sign flow — opens auth popup when no token cached
05ed3d9 fix(extension): fix Gmail DOM selectors for recipient extraction, toolbar injection, and manifest paths
ff41f21 Merge remote-tracking branch 'origin/feat/extension-launcher'
6065a81 feat(extension): popup launcher, auth token, session store, API client, banner injection (PFL-EXT-LAUNCHER)
c8d1e07 feat(web-admin): add demo hub landing page with tile navigation
84a8312 fix(demo): force fixture mode in production, fix cosign hash verification, add web-sign hosting target
a9235e8 fix(webauthn): align RP ID with Firebase Hosting URL (proofline-sign.web.app)
7011151 fix(webauthn): reconcile RP ID to proofline.web.app across server + extension + popup (PFL-RP-ID-RECONCILE) (#40)
33b0ad6 feat(web-sign): WebAuthn popup ceremony surface (PFL-044) (#39)
0ce65ba feat(web-admin): counterparty invitation flow + dashboard (PFL-049) (#38)
4de79f2 feat(web-counterparty): cosign deep-link landing surface with F-SIG-09 6-step verification (PFL-037) (#37)
666cb65 feat(functions): GET /v1/verify/:id verification HTTP endpoint (PFL-023) (#36)
476aa14 feat(web-admin): onboarding wizard UI with 9 steps + fixture mode (PFL-017) (#35)
02d69fe feat(functions): anchor batch + scheduler + manual trigger (PFL-027) (#34)
be15c02 Merge pull request #33 from Collns/crypto_v2
bb1a089 feat:/ kyb
283c9d4 Merge pull request #32 from Collns/crypto_v1
843ac6f feat: kms provider
```

Two engineers visible: `dan-od` (main author) and `Collns` (kms + crypto + kyb branches). Last 36 hours have been extension wiring + RP ID reconciliation + Functions deploy.

---

**Audit complete.** Full data summarized above. Report written by Claude as a read-only audit; no source files modified.
