# ProofLine — repo ↔ Kanban reconciliation (2026-11-18)

Scope: `Collns/ProofLine` `main` @ `021e3be` vs. Kanban project **ProofLine Hackathon [PFL]** (`824c4d55a4`).
Board snapshot: 131 tasks — 84 done, 47 todo, 0 in-progress. **No Kanban writes have been made**; every change below is a proposal awaiting approval.

---

## TL;DR

- **Git is quiet, not ahead.** Since the last board activity (2026-07-12) the only change on `main` is the merge commit for PR #109 (PFL-130), merged **today**. The board isn't stale on status. It's stale on **descriptions**: several todos describe code that has since changed, or never existed.
- **Every branch is already merged.** No unmerged work exists anywhere. The big "ahead" counts on old local branches come from a `main` history rewrite (circa 2026-06-05, see `backup/main-before-sync`). `git cherry` shows **0 unique patches** on every one of them. `origin/feat/PFL-048` was merged in PR #70 and its tree is identical to the merged commit.
- **Category a/b (todo but merged / unmerged branch): none.**
- **Big hidden gap: no outbound email is actually sent.** The Resend adapter exists (`packages/email/src/providers/resend.ts`) but `apps/functions` never wires it: cosign links, OTPs and invitations are logged or stubbed. This blocks PFL-136, PFL-132, PFL-146, PFL-142, and there's no task for it.
- **KYB is 100 % stub at the app edge.** `apps/functions/src/wiring/stubs.ts:134` hard-codes a stub provider. The Middesk adapter (PFL-012, "done") was never wired, so swapping vendors means adding a new adapter plus env-driven selection. No running path needs ripping out.
- ~30 merged PFL-IDs (bugfix/hardening PRs #56–#103) have **no board task**, and a few git IDs **collide** with different board tasks (e.g. git "PFL-023" = verify endpoint; board PFL-023 = E2E test).

---

## Step 1 — Git scan

`git fetch --all --prune` pruned 4 stale remote-tracking refs (`fix/verify-*`). Ahead/behind counts are relative to `main`.

| Branch | Last commit | Author | Behind / ahead | Merged? | Unique patches (`git cherry`) | Verdict |
|---|---|---|---|---|---|---|
| `main` / `origin/main` | 2026-11-18 | Collins Ehirim | 0 / 0 | — | — | — |
| `origin/feat/pfl-130-session-revoke` | 2026-07-12 | dan-od | 1 / 0 | ✅ (PR #109) | 0 | delete remote |
| `feat/pfl-130-session-revoke` (local) | 2026-07-12 | dan-od | 137 / 136 | pre-rewrite copy | 0 | delete local |
| `backup/main-before-sync` (local only, never pushed) | 2026-06-05 | dan-od | 137 / 135 | pre-rewrite backup of `main` | 0 | delete local |
| `feat/real-cloud-kms` (local only) | 2026-05-30 | dan-od | 137 / 130 | ✅ via PR #104 | 0 | delete local |
| `fix/register-credential-tests` (local only) | 2026-05-29 | dan-od | 137 / 124 | content on main | 0 | delete local |
| `fix/finalize-undefined-anchor` (local only) | 2026-05-28 | dan-od | 137 / 114 | content on main | 0 | delete local |
| `origin/feat/PFL-048` | 2026-05-24 | Collins | 137 / 95 | ✅ PR #70 (tree identical to merged `d8a24ba`) | 0 | **delete remote**, stale >30 days |
| `origin/docs/initial-context` | 2026-05-09 | dan-od | 138 / 0 | ✅ ancestor of main | 0 | delete remote, stale |

**Why the scary ahead counts:** every old branch's merge-base with `main` is `c50c6b0` (2026-05-09). `main` was rewritten after that, so the same commits exist on `main` under new hashes. Patch-ID comparison confirms nothing is lost.

**`main` first-parent history since 2026-05-01:** 115 commits. PRs #1–#109 all merged except closed #7, #8, #9, #26, #41. Since 2026-07-12: only `021e3be Merge PR #109 (PFL-130)`.

**Hygiene note:** GitHub isn't consistently auto-deleting head branches (PR #70 and #109 heads still exist). Turn on *Settings → General → Automatically delete head branches*.

---

## Step 2 — Board vs. git

### Category a) Todo but merged → none
No todo task ID appears in a merged PR with matching scope. The one textual hit, **PFL-023**, is an ID collision (see below), not completed work.

### Category b) Unmerged branch but todo → none
There are no unmerged branches.

### Category c) Done with weak or no PR evidence → verified in code

| PFL | Board | Evidence | Result |
|---|---|---|---|
| PFL-001/002/003 | done | setup tasks; `.env.example`, `firebase.json` present | trust (not code-verifiable) |
| PFL-011 / PFL-126 | done | PR #32 `crypto_v1`, PR #104 | ✅ |
| PFL-012 Middesk adapter | done | PR #33/#15; `packages/kyb/src/providers/middesk.ts` (282 LoC, tests) | ✅ code exists but **never wired** (edge uses stub). Superseded by the KYB swap |
| PFL-013 Stripe Identity | done | PR #42 `identity_v1`; `providers/stripe-identity.ts` | ✅ code exists, **edge uses stub** (`stubs.ts` `stubStripeIdentityProvider`) |
| PFL-014 Resend | done | PR #17; `packages/email/src/providers/resend.ts` | ✅ adapter exists, **never wired in functions** |
| PFL-024/025 bilateral | done | PR #45/#46 "bilateral updates"; `/v1/bilateral` mounted in `apps/functions/src/index.ts:65` | ✅ |
| PFL-036 final deploy | done | no git artifact possible | trust |
| PFL-038 re-verify before biometric | done | `apps/web-counterparty/src/lib/verify-checklist.ts` | ✅ |
| PFL-048 inbound badge | done | PR #70; `content/inject-badge.ts` + `background/verify-inbound.ts`, wired in `content/index.ts:50` | ✅ |
| PFL-049 session UI + wire toggle | done | PR #71; `content/wire-fields.ts` | ⚠️ **half-done**: `wire-fields.ts` is **never imported** anywhere, so the toggle doesn't render. Remaining scope = PFL-135 |
| PFL-052 DOM resilience | done | fallback selectors in `gmail-detector.ts`, graceful chip in `verify-inbound.ts` | ✅ (soft) |
| PFL-077 anchor scheduler crash | done | fixed inside `3f51f82` (esbuild deploy) / PR #34 | ✅ (soft) |
| PFL-123 register-credential tests | done | no PR; ran `vitest run register-credential` on main → **19/19 pass** | ✅ |
| PFL-129 device management | done | no own PR; `apps/web-admin/src/api/devices-client.ts` + revoke UI in `DashboardHome.tsx` (landed in #106/#108) | ✅ |
| PFL-130 | done (07-12) | PR #109 merged **2026-11-18**, not 07-12 | ✅ date drift only |

### Category d) Git work with no matching task

**Merged PFL-IDs absent from the board:** PFL-084, 086, 087, 088, 091, 092, 097.2, 098.2, 100–120 (21 IDs), 125.1, plus `PFL-RP-ID-RECONCILE` (#40). Also unnumbered PRs: #23 email_endpoints, #27 v1_onboarding, #30 popup auth, #42/#45/#46 identity/bilateral.

**ID collisions (git subject ≠ board task):**

| Git subject ID | Git work (PR) | Board task with that ID | Real board task for the git work |
|---|---|---|---|
| PFL-023 | verify HTTP endpoint (#36) | E2E onboard→sign→verify test (todo) | PFL-058 (done) |
| PFL-037 | cosign landing surface (#37) | JWS cosign link (done) | PFL-059 (done) |
| PFL-017 | onboarding wizard UI (#35) | onboarding API (done) | PFL-016 (done) |
| PFL-099 | Sign-button z-index (#72) **and** verify live mode (#75) | "investigate VerifyPage" (done) | — |
| PFL-076 / PFL-072 / PFL-073 / PFL-074 | #54 / #53 / #48 / #52 (unnumbered subjects) | match by scope | ✅ |

Recommendation: don't create ~30 retro tasks. Create **one** done "retro ledger" task that lists them (proposal H1 below). Going forward, always take the next ID from `get_board_rules` before branching.

**Unbuilt work with no task (found during the code audit):**
1. **Wire Resend `EmailProvider` at the functions edge.** `cosign-refresh.handler.ts:10` says emails are "logged for now". Blocks PFL-132/136/146/142 and the onboarding email OTP.
2. **Env-driven KYB / Stripe Identity provider selection.** Mirror `resolveKmsConfigFromEnv` in `stubs.ts:205`.

### Category e) Stale / abandoned branches
`origin/feat/PFL-048` is merged (PR #70) with an identical tree, so **delete it** (no merge or rebase needed). The others are listed in the Step 1 table; every one is safe to delete.

### "Currently empty / hardcoded / needs wiring" claims

| Task | Claim | Reality on main | Still true? |
|---|---|---|---|
| **PFL-026** invitations backend | `packages/invitations/src/index.ts` empty | Still `export {};`. `apps/web-admin/src/api/invitations-client.ts:27` calls `/v1/invitations`, **which isn't mounted**, so the UI falls back to fixtures. Only `GET /v1/admin/invitations` exists, and it reads `employee_invitations` (PFL-068), not counterparty invitations | ✅ **true** |
| **PFL-041** policy settings UI | limits hardcoded | `extension-auth.handler.ts:113-114` (`500_000` / `2_000_000`), `register-credential.handler.ts:564`, `stubs.ts:76`. No settings route in `web-admin/src/App.tsx` | ✅ **true** |
| **PFL-028** Gemini screening | "Implementation exists in `packages/ai/src/providers/gemini.ts`, needs wiring" | `packages/ai/src/index.ts` is `export {};` and `providers/` is **empty**. Nothing to wire; it has to be built from scratch | ❌ **description wrong** |
| **PFL-096** block send on fail | "may silently send unsigned" | The Sign button (`inject-toolbar.ts:41`) is separate from Gmail's Send, and there's **no Send interception** anywhere in `src/` | ✅ **true** |
| PFL-135 wire marking UI | not wired | `wire-fields.ts` is fully built (toggle, fields, validation) but **imported nowhere** | ✅ true, smaller than it looks |
| PFL-137 inbound badge | to build | Already built and wired via PFL-048 (verified, bilateral, spoof, rejected states plus sidebar). Remaining work is live Gmail QA | ⚠️ effectively a **duplicate** |

---

## Step 3 — KYB provider replacement (dropping Middesk)

### Middesk footprint (`grep -ri middesk`)

| Location | Refs | Action |
|---|---|---|
| `packages/kyb/src/providers/middesk.ts` + `__tests__/middesk.test.ts` | 32 + 27 | Delete once the new adapter lands (or keep behind a flag; it's harmless) |
| `packages/kyb/src/providers/stub.ts` (`middeskShape` in `raw`) | 2 | Rename to `vendorShape` |
| `packages/kyb/src/providers/stripe-identity.ts:49` error text | 2 | Generic "use a KYB business provider" |
| `packages/kyb/src/index.ts` comment | 1 | Update |
| `apps/functions/src/api/onboarding/kyb.handler.ts` (comments + log `"[kyb] Middesk call failed"`) | 4 | Vendor-neutral |
| `apps/functions/src/api/onboarding/router.ts`, `enroll-officer.handler.ts:102`, `wiring/stubs.ts` | 5 | Comments |
| `apps/web-admin/src/routes/steps/StepKYB.tsx:112` (UI label "Middesk reference") | 1 | "KYB reference" |
| `apps/web-admin/src/components/SkipDemoButton.tsx`, `OnboardingWizard.tsx` | 2 | Comments |
| `.env.example:10` `MIDDESK_API_KEY=` | 1 | Replace with new vendor key + `KYB_PROVIDER=stub\|baselayer\|cobalt` |
| `docs/PRD.md` (F-ON-03 L259, L415, L584, L708, L723, L1035, L1048) | 7 | Reword (below) |
| `docs/TDD.md` (§4.6 L323/L345, §5.1 L569/L589, §7.1 L910–958, L1535, L1586) | 14 | Rewrite §7.1 for the new vendor |
| `docs/MIDDESK-IMPLEMENTATION-BRIEF.md` | 72 | Archive or delete |
| `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/AUDIT-REPORT.md` | 4 | Update |
| Kanban: PFL-142 (todo), PFL-012 / PFL-003 / PFL-017 (done) | 4 | Edit PFL-142; comment on PFL-012 |

### Current state of `packages/kyb`
- Files: `types.ts`, `index.ts`, `providers/{stub,middesk,stripe-identity}.ts`. **There's no `composite.ts`**: business KYB and officer KYC are two separate providers that each throw `WRONG_PROVIDER` on the other's method.
- Interface (`types.ts`): `KYBProvider { verifyBusiness(BusinessLookupInput) → BusinessVerification; verifyOfficer(...) }`. Input requires `legalName`, `ein`, `state`, `country: 'US'`. Output is `{ ok, vendorRef, flags: {type, severity, detail?}[], officers: {name, role}[], raw }`.
- App edge: `makeStubOnboardingDeps()` in `apps/functions/src/wiring/stubs.ts:198` always injects `stubKybProvider` (and the stub Stripe Identity). Real KMS is the only env-selected provider (`resolveKmsConfigFromEnv`).
- `kyb.handler.ts` calls `verifyBusiness` **synchronously inside the HTTP request** (the Middesk adapter polled for up to 90 s). An async vendor should move to *start → webhook/poll → update company* instead.

### Vendor research
Checked against vendor signup, docs and pricing pages on 2026-11-18. No accounts were created. "Unverified" means the page returned 403/404/a bad certificate, or the claim came only from a third party.

| Vendor | Self-serve sandbox | SoS | EIN/TIN (IRS) | Officers / UBO | OFAC | Model | Public price |
|---|---|---|---|---|---|---|---|
| **Baselayer** | **Yes**: free sandbox at console.baselayer.com/signup | Yes (`registrations[]`) | Yes (`tin_matched`) | Officers | Yes (`watchlist_hits`, OFAC/PEP) | Async, but `Prefer: wait=N` makes it effectively sync. `BusinessSearch.updated` webhook | from $150/mo |
| **Cobalt Intelligence** | **Yes**: free account, live data | Yes (core product, 50 states) | Yes (separate call) | Officers + registered agent | Yes (separate call) | SoS sync 15–30 s, or `retryId` poll | credit-based, no $ published |
| Enigma | Partial: key only after picking a plan | Yes (`sos_*` tasks) | TIN add-on (IRS source unconfirmed) | Registered persons; officers unclear | Watchlist add-on | Sync | Pro ~$20/mo (third-party) |
| Footprint | Probably (dashboard sandbox toggle) | Not documented | Not documented | Owners via separate KYC | Watchlist | Mostly sync, webhook if pending | Unverified |
| Persona | Partial: KYB not on the Startup plan, limited on Essential | BRV | Yes (Essential) | **No officers below Growth** | Business watchlist | Inquiry + webhook | ~$250/mo (third-party) |
| OpenCorporates | Paid self-serve | Registry data | No | Officers (unconfirmed) | No | Sync | £225/mo / 500 calls |
| Trulioo | Unverified | Unverified | Unverified | UBO Discovery | Unverified | — | — |
| Alloy | No (demo-led) | — | — | — | — | — | — |
| Sardine | **No** (sandbox via a Sardine contact; US KYB runs on Middesk underneath) | via Middesk | via Middesk | via Middesk | Yes | Async | — |
| Plaid | No KYB product (Identity Verification covers people only) | — | — | — | people only | — | — |
| Stripe | No standalone KYB (only inside Connect onboarding; Identity covers people) | — | — | — | — | — | — |

Sources:
- Baselayer: [docs](https://docs.baselayer.com/docs/business-search), [sandbox](https://docs.baselayer.com/docs/sandbox-vs-production-environments.md), [pricing](https://baselayer.com/pricing/)
- Cobalt: [TIN](https://help.cobaltintelligence.com/article/tin-verification-purpose), [OFAC](https://help.cobaltintelligence.com/article/ofac-billing), [pricing structure](https://help.cobaltintelligence.com/article/pricing-structure-overview); its pricing page returned 403
- Enigma: [KYB quickstart](https://documentation.enigma.com/guides/kyb-api/quickstart/)
- Footprint: [business onboarding](https://docs.onefootprint.com/llms/api-reference/business-onboarding.md)
- Persona: [help article](https://help.withpersona.com/articles/4Z9k3Y9n4xlN6jMQpoVrGu/)
- OpenCorporates: [pricing](https://opencorporates.com/pricing/)
- Sardine: [KYB](https://docs.sardine.ai/guides/public/risk/accountrisk/kyb), [client onboarding](https://docs.payments.sardine.ai/integration_guides/onboarding_and_testing/client_onboarding)
- Plaid: [Identity Verification](https://plaid.com/docs/identity-verification/)
- Stripe: [Connect identity verification](https://docs.stripe.com/connect/identity-verification)
- Alloy: [developer docs](https://developer.alloy.com/)

### Recommendation
- **Primary: Baselayer.** It's the only vendor confirmed today to offer self-serve signup and a free sandbox, and it returns SoS, IRS TIN match, officers and OFAC from **one call**. With `Prefer: wait=N` it fits the existing synchronous `kyb.handler.ts` without a redesign. Caveats: the sandbox accepts only Baselayer's predefined test businesses (inputs must match exactly), and production starts at $150/mo.
- **Fallback: Cobalt Intelligence.** Free self-serve account on live data. It covers SoS, officers, TIN and OFAC, but `verifyBusiness()` has to fan out to about 3 calls and SoS can take 15–30 s or return a `retryId`, so it needs a Functions timeout of at least 120 s. It's also useful as a cheap SoS cross-check.
- Not recommended: Sardine (Middesk underneath), Persona (no officers below the Growth plan), Plaid and Stripe (no standalone KYB).

### Adapter sketch — `packages/kyb/src/providers/baselayer.ts` (not implemented)

```ts
import type { KYBProvider, BusinessLookupInput, BusinessVerification, KYBFlag } from "../types.js";

export interface BaselayerConfig {
  apiKey: string;
  baseUrl?: string;          // sandbox vs prod host per Baselayer docs
  waitSeconds?: number;      // Prefer: wait=N (default 25, under the Functions timeout)
  fetch?: typeof globalThis.fetch;
}

export function makeBaselayerProvider(cfg: BaselayerConfig): KYBProvider {
  const f = cfg.fetch ?? globalThis.fetch;
  return {
    async verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification> {
      const res = await f(`${cfg.baseUrl}/searches`, {
        method: "POST",
        headers: {
          "X-API-Key": cfg.apiKey,
          "Content-Type": "application/json",
          Prefer: `wait=${cfg.waitSeconds ?? 25}`,
        },
        body: JSON.stringify({
          name: input.legalName,
          tin: input.ein?.replace(/\D/g, ""),
          address: { state: input.state },        // Baselayer wants city+state minimum: extend BusinessLookupInput
        }),
      });
      if (!res.ok) throw new Error(`BASELAYER_HTTP_${res.status}`);
      const s = await res.json();

      const flags: KYBFlag[] = [
        ...(s.warnings ?? []).map((w: any) => ({ type: `warning:${w.code ?? w}`, severity: "medium" as const, detail: w.message })),
        ...(s.watchlist_hits ?? []).map((h: any) => ({ type: "sanctions_hit", severity: "high" as const, detail: h.list ?? h.source })),
        ...(s.tin_matched === false ? [{ type: "tin_mismatch", severity: "high" as const }] : []),
        ...(s.tin_matched == null ? [{ type: "tin_pending", severity: "low" as const, detail: "IRS unavailable; awaiting BusinessSearch.updated" }] : []),
        ...(s.state !== "COMPLETED" ? [{ type: "search_pending", severity: "low" as const }] : []),
      ];

      return {
        ok: Boolean(s.verified) && s.tin_matched !== false && !(s.watchlist_hits?.length),
        vendorRef: s.id,
        flags,
        officers: (s.business_officers ?? []).map((o: any) => ({ name: o.name, role: o.titles?.[0] ?? o.title ?? "officer" })),
        raw: s,
      };
    },
    async verifyOfficer() {
      throw new Error("WRONG_PROVIDER: use Stripe Identity for verifyOfficer");
    },
  };
}
```

Field names follow Baselayer's Business Search docs and must be confirmed against the sandbox response in PFL-161. Edge changes for PFL-162:
- add `resolveKybConfigFromEnv` (`KYB_PROVIDER=stub|baselayer|cobalt`, `BASELAYER_API_KEY`) next to `resolveKmsConfigFromEnv` in `wiring/stubs.ts`
- add a `POST /v1/webhooks/kyb/baselayer` handler that updates `companies/{id}.kybResult` when `tin_pending`/`search_pending` resolve
- extend `BusinessLookupInput` with optional `city`/`address`.

---

## Step 4 — Plan

### 4.1 Board hygiene (proposed calls, nothing executed)

Owner tags: **A = backend/functions track, B = frontend/extension track** (inferred from history: dan-od backend-heavy, Collins on extension and admin UI; correct this if it's wrong).

**Updates / comments**

| # | Call | Change |
|---|---|---|
| H2 | `update_task PFL-028` | description → "`packages/ai` is empty (`export {}`); no `gemini.ts` exists. Build `providers/gemini.ts` + `screenMemo()` and wire it into the sign pipeline for `isWireInstruction` payloads." Add `difficulty:medium`. |
| H3 | `update_task PFL-135` | description → "`apps/extension-chrome/src/content/wire-fields.ts` (PFL-049) is complete but never imported. Mount it in `inject-toolbar.ts`, feed `readWireFields()` into `extractPayload`/canonical payload, block Sign when `isValid=false`." Tags: `difficulty:easy`, `owner:B`, priority **high** |
| H4 | `update_task PFL-137` | retitle "QA + harden inbound verification badge in live Gmail (F-VER-09)". Description notes it's implemented in `inject-badge.ts`/`verify-inbound.ts` (PFL-048), and scope = live test across the 5 states + selector fixes. `difficulty:easy`, `owner:B` |
| H5 | `update_task PFL-142` | replace "KYB flagged by Middesk" with "KYB flagged by the KYB provider (`flags[]` severity ≥ medium / `ok=false`)" |
| H6 | `update_task PFL-096` | append: "Verified 2026-11-18: no Send interception exists; the Sign button is separate. Needs a capture-phase listener on Gmail Send + Ctrl/Cmd+Enter, and an explicit 'send unsigned' escape hatch." Tags `difficulty:hard`, `owner:B` |
| H7 | `update_task PFL-026` | append: "Verified 2026-11-18: still empty. web-admin calls `/v1/invitations` (not mounted) → fixture fallback. Employee invitations (PFL-068, `employee_invitations`) are separate." Tags `difficulty:medium`, `owner:A` |
| H8 | `update_task PFL-041` | append the hardcoded locations (`extension-auth.handler.ts:113-114`, `register-credential.handler.ts:564`). Needs a `companies/{id}.policy` doc + `PATCH /v1/admin/policy` + UI |
| H9 | `add_comment PFL-012` | "Adapter never wired at the edge (stub only). Middesk dropped 2026-11-18; superseded by PFL-161/162." |
| H10 | `add_comment PFL-049` | "Wire toggle module built but never mounted; remaining work tracked in PFL-135." |
| H11 | `add_comment PFL-130` | "PR #109 actually merged 2026-11-18." |
| H12 | `add_comment PFL-023` | "Note: git PR #36 is labelled PFL-023 but implements PFL-058. This task is still open." |

**New tasks** (next ID per board rules = PFL-159)

| # | Call | Task |
|---|---|---|
| H1 | `create_task PFL-159` → `move_task done` | `chore(board): retro ledger — merged PRs without board tasks`. Lists PFL-084, 086–088, 091–092, 097.2, 098.2, 100–120, 125.1, RP-ID-RECONCILE, plus the ID collisions table. Sprint: none. Group: Bugfixes |
| N1 | `create_task PFL-160` | `feat(email): wire Resend EmailProvider at functions edge`. Env-select `makeResendProvider` vs stub (`RESEND_API_KEY`), inject into cosign-refresh, verify-email OTP, bilateral notify. **high**, `owner:A`, `difficulty:easy`, Phase 5. Blocks PFL-132, 136, 142, 146 |
| N2 | `create_task PFL-161` | `feat(kyb): Baselayer adapter`. `packages/kyb/src/providers/baselayer.ts` + fixtures/tests against the sandbox. **high**, `owner:A`, `difficulty:medium`, module KYB, Phase 4 |
| N3 | `create_task PFL-162` | `feat(kyb): env-driven KYB + Stripe Identity provider selection at edge`. `resolveKybConfigFromEnv` (`KYB_PROVIDER=stub\|baselayer\|cobalt`), async start + webhook/poll in `kyb.handler.ts`, store `kybResult.status=pending`. **medium**, `owner:A`, `difficulty:medium` |
| N4 | `create_task PFL-163` | `chore(kyb): remove Middesk references from code + docs`. Rename stub `middeskShape`, StepKYB label, `.env.example`, archive `MIDDESK-IMPLEMENTATION-BRIEF.md`, delete `middesk.ts` + test. **low**, `difficulty:easy` |
| N5 | `create_task PFL-164` | `docs: PRD F-ON-03 + TDD §4.6/§7.1 vendor swap`. Wording below. **low**, `owner:either`, `difficulty:easy` |
| N6 | `create_task PFL-165` (optional) | `feat(kyb): Cobalt Intelligence fallback adapter`. Only if we want a live fallback; otherwise a note in PFL-161 |

### 4.2 Branch cleanup (proposed; not executed)

```bash
git branch -D backup/main-before-sync feat/real-cloud-kms fix/register-credential-tests fix/finalize-undefined-anchor feat/pfl-130-session-revoke
```
```bash
git push origin --delete feat/PFL-048 docs/initial-context feat/pfl-130-session-revoke
```
Nothing to merge or rebase. Optionally keep `backup/main-before-sync` as a tag (`git tag archive/main-before-sync backup/main-before-sync`) before deleting.

### 4.3 Critical-path build order

| Order | Task | Why now | Difficulty | Owner | Depends on |
|---|---|---|---|---|---|
| 0 | **PFL-160** wire Resend | unblocks every flow that emails a human | easy | A | — |
| 1 | **PFL-135** wire marking UI | module already built; required to produce a $400k wire for the cosign demo | easy | B | — |
| 2 | **PFL-096** block send on sign fail | biggest trust hole: unsigned mail can go out | hard (Gmail Send hooking, keyboard shortcut, Gmail DOM drift) | B | — |
| 3 | **PFL-136** cosign E2E | headline demo flow; server endpoints exist (PFL-062), missing are email delivery + UI glue + test | hard | A (+B for UI) | 160, 135 |
| 4 | **PFL-137** inbound badge QA | already built; cheap credibility win | easy | B | — |
| 5 | **PFL-026** invitations backend → **PFL-132** emails | UI exists and runs on fixtures; backend = `/v1/invitations` CRUD + stats + bulk CSV | medium → easy | A | 160 (for 132) |
| 6 | **PFL-023** API-level E2E | extend `api/onboarding/__tests__/onboarding.e2e.test.ts` into onboard → register → sign → verify | medium | A | — |
| 7 | **PFL-161/162** KYB swap | parallel track; edge is stub today so nothing breaks meanwhile | medium | A | vendor sandbox key |
| 8 | **PFL-053** extension Playwright E2E | do last, after 096/135/137 stop moving the DOM | hard | B | 096, 135, 137 |
| 9 | PFL-041 policy UI, PFL-080 sign handler coverage, PFL-078 challenge hardening | quality/config | medium | A/B | — |

Parallel lanes: **A** = 160 → 136 (server) → 026 → 023 → 161/162. **B** = 135 → 096 → 137 → 136 (UI) → 053.

### 4.4 KYB swap tasks
See N2–N6 above. Proposed wording:

- **PRD F-ON-03:** "Business KYB via a pluggable KYB provider (primary: *Baselayer*; fallback: *Cobalt Intelligence*). Must cover Secretary of State registration, EIN/TIN match and OFAC screening. Self-serve sandbox required. P0 sandbox / P1 prod." Replace "Middesk" with "KYB provider" in L415, L584, L708, L723, L1035, L1048.
- **TDD §4.6:** `vendorRef // vendor business/verification ID`; list `providers/baselayer.ts`. Make `ein` optional in `BusinessLookupInput` if the vendor supports name+state lookup.
- **TDD §7.1:** retitle "KYB provider (Baselayer)" with the adapter sketch from Step 3 and the async start/webhook flow; drop the Middesk sandbox URL.
- **PFL-142:** see H5.

### 4.5 Defer or cut

| Defer to post-launch (Phase 10, leave todo, de-prioritise) | Cut / close candidates |
|---|---|
| PFL-152/153 Outlook web + desktop, PFL-154 Base mainnet, PFL-155 attachment signing, PFL-156 reply-chain hashing, PFL-157 Stripe Billing, PFL-158 SOC 2 | PFL-137, if after QA it's confirmed a pure duplicate of PFL-048 |
| Phase 9 website (PFL-149/150/151) unless a launch date exists | PFL-054/055 (already marked POST-HACKATHON) |
| Phase 6 platform admin (140–145): keep 140 + 142 (needed for KYB manual review); defer 141/143/144/145 | PFL-030 onboarding animation (polish) |
| PFL-028 Gemini screening (now known to be a from-scratch build) | Demo items PFL-031–035 only matter if there's a scheduled demo; otherwise close or move to a "Demo" backlog |
| PFL-064 ADRs (keep low; `docs/adr/` exists) | |

---

## Step 5 — Demo-shortcut audit (production readiness)

Method: ran `git grep -iE 'stub|demo|mock|fake|hardcod|placeholder|dev-user|dev-company|skip|TODO|FIXME'` over `apps/` and `packages/` (tests, fixtures and `dist/` excluded; 358 hits) and read every hit in context. I also searched for `fixture`, `import.meta.env.PROD/DEV`, env fallbacks (`process.env… ??`) and hardcoded hosts. Hits that are false positives are listed at the end.

Classes: **(a)** security hole · **(b)** fake feature in the prod path · **(c)** dev-only (marked gated / **not gated**) · **(d)** dead code.

**Cross-cutting finding:** none of the web apps gate fixture or demo paths on `import.meta.env.PROD`, and Cloud Functions v2 does not set `NODE_ENV=production`. That makes the existing "throw in production" checks (e.g. anchoring) ineffective. Production needs an explicit `PROOFLINE_ENV` plus explicit provider selection.

### apps/functions

| # | Class | Location | Finding | Fix |
|---|---|---|---|---|
| F1 | a | `src/index.ts:234-248, 293-299, 323-329` | `stubAuthMiddleware` sets `req.user = {userId:"dev-user", companyId:"dev-company"}` on **/v1/onboard/*** and **/v1/bilateral/*** with no token check. | Firebase ID-token middleware; delete the stub. |
| F2 | a | `api/onboarding/finalize.handler.ts:72-76, 140-170` | `demoMode:true` (sent by any caller) skips the ownership check **and** the onboardingStatus/KYC gates, then mints a KMS root key + owner role credential. | Delete `demoMode`; finalize enforces owner + every prior-step gate. |
| F3 | a | `api/onboarding/start.handler.ts:57-59` | Owner UID comes from `body.ownerUserId` instead of the authenticated user, so anyone can create a company owned by another UID. | Owner = verified token UID only. |
| F4 | a | `api/bilateral/jws.helpers.ts:17`, `cosign/cosign.helpers.ts:81`, `auth/extension-auth.handler.ts:52`, `register-credential.handler.ts:77`, `require-extension-auth.middleware.ts:38` | Hardcoded secret fallbacks (`"dev-secret-change-in-prod"`, etc.). `BILATERAL_JWT_SECRET` and `COSIGN_REFRESH_SECRET` are **not bound** as Functions secrets and are not promoted by `esbuild.config.mjs`, so prod almost certainly runs on the hardcoded defaults and those tokens are forgeable. | Bind all secrets via `defineSecret`; no fallback; missing secret = startup error. |
| F5 | a | `anchoring/manual.ts:16-17, 111-114`; `index.ts:178-191` | `POST /v1/admin/anchor/run` (`anchorAdmin` export) has **no auth**: anyone can trigger anchor batches and spend gas. | Require platform-admin Firebase auth, or remove the endpoint. |
| F6 | a | `cosign/cosign-finalize.handler.ts:225-243` | The cosigner's WebAuthn assertion is "best-effort": an unverified assertion is logged and **accepted**. | Reject on failed verification. |
| F7 | a | `api/bilateral/sign-as-counterparty.handler.ts:21, 48-59` | Counterparty `userId` / `companyId` come from the request body; the token only scopes the docId. | Derive identity from the token / verified assertion. |
| F8 | a | `wiring/stubs.ts:191-196` | The onboarding email code is printed to the function log, never emailed. The email gate is fake, and codes leak into logs. | Resend via EMAIL_PROVIDER (PFL-160); never log codes. |
| F9 | a | `verify/handlers/verify.handler.ts:171,176` → `packages/verification/src/checks.ts:130-137`, `verify.ts:32-39` | `legacySignatureFallback:true` lets an envelope with an **invalid signature** pass when authData is missing (not limited by date). `trustUnsignedRoleCredentials:true` skips the issuer chain for `issuerSig:""`. | Restrict the legacy path to rows before a cutoff (or flag them); sign role credentials with the KMS root (PFL-100.1) and remove the flag. |
| F10 | b | `signing/handlers/signing.helpers.ts:68-80` | Session-token keys are generated in process. Tokens don't verify across instances, so silent signing works only on a warm container. | Persistent key (KMS / Secret Manager). |
| F11 | b | `wiring/stubs.ts:134-196, 198-224`; `index.ts:290` | Onboarding deps are all stubs: KYB always ok, Stripe Identity always verified, anchor provider returns fake `0xstub-` tx hashes, email code logged. Only KMS is env-selected, and it silently falls back to a stub signer (`"stub-signature-not-cryptographic"`). | Explicit providers (KYB/IDV may stay stub but labelled + routed to review); anchoring/KMS/email real and fail-closed. |
| F12 | b | `index.ts:316` | Bilateral uses `makeStubEmailProvider()`: counterparties are never notified. | EmailProvider from config. |
| F13 | b | `cosign/cosign-refresh.handler.ts:10, 76` | The cosign refresh link is "sent" by logging it. | EmailProvider. |
| F14 | b | `wiring/firestore-policy-context.ts:39-151` | Only `getUser` is real. Company policy is `DEMO_COMPANY_POLICY`; daily totals, counterparty lookup, risk, session read/revoke and nonce dedupe are permissive in-memory stubs (nonces are not shared across instances, so replay protection is per instance). | Firestore-backed PolicyContext. |
| F15 | b | `auth/extension-auth.handler.ts:108-128, 451-452`; `register-credential.handler.ts:564` | Hardcoded limits ($500k / $2M); `LEGACY_DEMO_COMPANY_ID="dev-company"`; `PLACEHOLDER_CREDENTIAL_ID` sentinel. | Company policy doc (PFL-041); return `credentialId:null`. |
| F16 | b | `anchoring/service-factory.ts:286-309`; `index.ts:200-210` | Stub anchor fallback depends on `NODE_ENV`, which Functions doesn't set. The verify router silently falls back to a stub chain reader. | `ANCHOR_PROVIDER` explicit; fail closed. |
| F17 | c not gated | `anchoring/manual.ts:12-14`, `anchoring/README.md:48-58`, `index.ts:9-10` | Demo-prep comments and "hardcoded ALLOW" anchor trigger. | Remove with F5. |
| F18 | b | `cosign/cosign-refresh.handler.ts:15` | No rate limit on cosign refresh (TODO). | Per-message cap. |
| F19 | b | `register-credential.handler.ts:477` | Role credentials are not signed by the company root (TODO PFL-100.1). Ties to F9. | KMS issuer signing. |
| F20 | d | `wiring/gcp-kms-provider 2.ts` (+ `… 2.test.ts`) | Duplicate files ("… 2"). | Delete. |
| F21 | c not gated | `esbuild.config.mjs:186-191` | Deploy proceeds with "will use stubs" when env is missing. | Fail the build for prod targets. |

### Web apps, extension, packages (summary of 45 findings)

| # | Class | Location | Finding | Fix |
|---|---|---|---|---|
| W1 | a | `web-admin/src/routes/steps/StepKeyCeremony.tsx:104-106` | Client hardcodes `finalize({demoMode:true})` for every user (pairs with F2). | Remove. |
| W2 | a | `web-admin` `SkipDemoButton` in StepDNS:183, StepEmail:143, StepKYB:96, StepKYC:213; `OnboardingWizard.tsx:48-108` | "Skip for demo" buttons are shown in prod and mark DNS/email/KYB/KYC as verified (`vendorRef:'demo-skipped'`). | Delete; seeding moves to a dev-only script. |
| W3 | a | `web-admin/src/api/client.ts:108-121` | Owner UID from `?uid=` / localStorage (pairs with F3). | Remove. |
| W4 | a | `web-verify/src/api/client.ts:18-25` | `?fixture=` on any `/v/:id` renders a fixture "Verified" on the real verify domain, so a phisher can send a ProofLine-branded "verified" link. | Strip fixtures from prod. |
| W5 | a | `web-counterparty/src/routes/BilateralLanding.tsx:29-30, 118-119` | Counterparty `cid` / `uid` taken from the URL (pairs with F7). | Server-derived identity. |
| W6 | a | `web-sign/src/api/client.ts:27-33` | The 30-day extension token is passed in the URL query (history / Referer leak). | postMessage or fragment; shorter TTL. |
| W7 | b | `web-counterparty/src/api/client.ts:28-33` | `resolveMode()` **always returns `'fixtures'`**: cosign context / finalize / refresh never call the server; every cosign is a fake success. | Default live; fixtures DEV-only. |
| W8 | b | `web-admin/.../StepKeyCeremony.tsx:61`, `lib/webauthn-bridge.ts:26-40` | Owner passkey is created from client-generated options and never sent to the server. | Server-issued challenge + upload attestation. |
| W9 | b | `web-admin/.../StepKYC.tsx:76-88`, `lib/stripe.ts:17-21` | With no Stripe publishable key, a 2 s fake animation marks KYC verified in prod. | Fail closed. |
| W10 | b | `extension-chrome/src/background/popup-manager.ts:71-78, 231-239`, `index.ts:472` | Stores `placeholder-credential-id` as the credential and signing proceeds with it. | Force registration. |
| W11 | b | `extension-chrome/src/background/index.ts:326-360` | When the server returns no banner, the client fabricates a "✓ Verified by ProofLine" banner. | Fail / retry. |
| W12 | b | `web-admin/src/App.tsx:19-20`, `routes/DemoHub.tsx`; `web-counterparty/src/App.tsx:15`; `web-verify/src/App.tsx:12`, `NotFoundPage.tsx:18-21` | Public `/` routes land on demo hubs and fixture pages; DemoHub links to the Firebase console. | Real landing / login; remove demo routes. |
| W13 | b | `web-admin/.../StepAnchored.tsx:14`, `web-verify/.../AnchorReceipt.tsx:84`, `lib/basescan.ts` | Sepolia explorer hardcoded. | Network from config. |
| W14 | b | `web-admin/.../StepInstallExtension.tsx:8-10` | Placeholder Chrome Web Store URL. | Real listing (PFL-139). |
| W15 | b | `packages/email/src/providers/resend.ts:88-92` | Invite link host `app.proofline.web.app/invite/…` doesn't exist; `inviterCompany` interpolated into HTML unescaped. | Config URL + escape. |
| W16 | b | `packages/onboarding/src/steps/kyc.ts:22-32` | Synchronous `verifyOfficer` "for the demo"; no Stripe session / webhook flow. | Session + webhook (IDV slot). |
| W17 | b | `packages/kyb/src/providers/middesk.ts:86` | Defaults to sandbox URL (moot once Middesk is removed). | PFL-163. |
| W18 | c **not gated** | `web-admin/src/api/client.ts:41-54` + `api/fixtures.ts`; `invitations-client.ts:43`; `StepKYC.tsx:27-29`; `StepKeyCeremony.tsx:32-34`; `web-counterparty` `?fixture=` paths (`client.ts:35-51`, `CosignLanding.tsx`, `BilateralLanding.tsx:12-14`) | Query-param / env fixture modes reachable in prod bundles; the counterparty fixture injects a hasher that bypasses the payload-hash check. | `import.meta.env.DEV` gate + tree-shake. |
| W19 | c **not gated** | `web-admin/src/api/client.ts:73`, `invitations-client.ts:65` | Sends `Bearer DEV_PLACEHOLDER_TOKEN` when not signed in. | Redirect to login. |
| W20 | c **not gated** | `web-admin/src/lib/firebase.ts:9-21` + 5 copies of the functions URL; `web-sign/src/lib/firebase.ts:25-27` (`AIzaSyAExample…`); `web-counterparty` `VITE_FUNCTIONS_BASE_URL` vs `VITE_API_BASE`; `web-verify/src/api/client.ts:8` | Silent fallbacks to project `proofline-cdabb` / hardcoded hosts. | One shared config; fail the build when missing. |
| W21 | c **not gated** | `web-sign` RP ID in 3 files; `extension-chrome/src/shared/config.ts:9-15`, `manifest.json` | Hardcoded origins / RP ID; no per-env build. | Env-injected constants. |
| W22 | c **not gated** | `packages/email/src/banner.ts:62, 215` | Verify URL / site link hardcoded. | Config. |
| W23 | c gated | `packages/*/src/providers/stub.ts` (kyb, email, crypto, observability) | Stub providers; only reachable by explicit import. Selection happens in functions (F11). | Keep for tests; prod wiring refuses them (except labelled KYB/IDV). |
| W24 | c gated | `apps/design-prototype` (whole app); `vite.config.ts:11` | Visual mock, **not deployed** (no hosting target) but built by CI; `define` would bake `GEMINI_API_KEY` into the bundle. | Move out of `apps/` (or exclude from CI); drop the define. |
| W25 | d | `web-admin/src/routes/DashboardHome.old.tsx`; `web-admin/src/api/invitations-types.ts:4`; `extension-chrome/src/background/messages.ts:8-30` (stub handleMessage), `index.ts:194-198` (stub ack); `packages/invitations` (empty), `packages/ai` (empty) | Dead code / empty packages. | Delete or implement (PFL-026, PFL-028). |

**Ignored (false positives):** about 28 input `placeholder=` attributes; "skip" in normal control flow (gmail-detector, inject-badge, popup-launcher, admin-data, DashboardHome, bulk-invite skipped reasons, anchoring queue skip); `skipLibCheck`; owner "demotion" in update-role; test-override comments; `extract-payload.ts:455-462` (placeholder fields used only for schema validation and then stripped).

### Mapping to Phase 11 tasks
| Phase 11 task | Findings |
|---|---|
| Real Firebase Auth on onboarding + bilateral; delete stubAuthMiddleware | F1, F3, F7, W3, W5, W19 |
| Remove demoMode; finalize enforces all gates; owner passkey enrolled server-side | F2, W1, W8 |
| Remove SkipDemoButton + fixture shortcuts from prod builds; dev-only seed script | W2, W4, W7, W9, W18 |
| Explicit provider selection + fail-closed config (email, anchoring, KMS, KYB, IDV) and secrets | F4, F11, F16, F21, W20, W21 |
| Lock down anchor admin endpoint | F5, F17 |
| Cosign hardening (verify assertion, rate limit, real counterparty client) | F6, F18, W7 |
| Firestore-backed PolicyContext + persistent session-token key | F10, F14, F15 |
| Verification strictness (legacy fallback cutoff, KMS-signed role credentials) | F9, F19 |
| Extension: no placeholder credential, no client-fabricated banner | W10, W11 |
| web-sign token transport | W6 |
| Stripe Identity adapter + IDV slot (async session / webhook) | W16 (PFL-162) |
| Stub-verified companies → manual review | PFL-142 / PFL-162 |
| Move DemoHub, design-prototype, demo constants out; delete dead code | W12, W24, W25, F20 |
| Config-driven network / explorer / hosts / links | W13, W14, W15, W22 |
