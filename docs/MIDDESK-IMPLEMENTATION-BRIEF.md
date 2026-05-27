# Middesk Implementation Brief

**Date:** 2026-05-18
**Purpose:** Pre-call technical refresh for Middesk sales call (Peter Cullen, Mon 12:30 PM ET)
**Commit:** d5e948d (branch: main, clean)

---

## TL;DR

- **Adapter is built and tested.** `packages/kyb/src/providers/middesk.ts` is a complete `KYBProvider` implementation (start → poll → map) with a 7-case test suite that exercises happy path, sanctions hit, name mismatch / manual review, multi-poll, auth failure, and missing-key paths against a faithful in-memory fake of Middesk's HTTP API. Sandbox base URL is the default. Bearer auth is wired.
- **It is NOT wired into the running HTTP API yet.** The deployed `POST /v1/onboard/kyb` handler is constructed in [apps/functions/src/index.ts:266](apps/functions/src/index.ts#L266) with `makeStubOnboardingDeps()`, which injects a stub `kybProvider` that always returns `ok: true` with a hardcoded "Stub Officer". The real Middesk provider is never instantiated at runtime today.
- **What unlocks when sandbox keys arrive:** mostly a 5-line wiring change in `apps/functions/src/index.ts` (or a new `makeLiveOnboardingDeps()`) to call `makeMiddeskProvider({ apiKey: process.env.MIDDESK_API_KEY })` and pass it through. No webhook handler exists yet — we'd be running poll-only against sandbox. `.env.example` already has the `MIDDESK_API_KEY` slot; `.env.local` has the var but it is empty.

---

## 1. Files touched by Middesk integration

| Path | Role | Live or Stub |
|---|---|---|
| [packages/kyb/src/providers/middesk.ts](packages/kyb/src/providers/middesk.ts) | Real Middesk adapter — POST + poll + map | **Live code, not wired** |
| [packages/kyb/src/providers/stub.ts](packages/kyb/src/providers/stub.ts) | Standalone stub provider mirroring Middesk shapes (used by tests of `@proofline/kyb`) | Stub |
| [packages/kyb/src/types.ts](packages/kyb/src/types.ts) | `KYBProvider`, `BusinessLookupInput`, `BusinessVerification`, `KYBFlag` zod + TS types | Contract |
| [packages/kyb/src/index.ts](packages/kyb/src/index.ts) | Public package surface — exports types only, requires explicit provider imports | Contract |
| [packages/kyb/src/__tests__/middesk.test.ts](packages/kyb/src/__tests__/middesk.test.ts) | 7 vitest cases against an in-memory FakeMiddesk that asserts URL/header/body shape | Test |
| [apps/functions/src/api/onboarding/kyb.handler.ts](apps/functions/src/api/onboarding/kyb.handler.ts) | `POST /v1/onboard/kyb` handler — calls `kybProvider.verifyBusiness()` and advances onboarding state | Live handler, **but redeclares its own local `KYBProvider` interface** (does not import from `@proofline/kyb`) |
| [apps/functions/src/api/onboarding/router.ts](apps/functions/src/api/onboarding/router.ts) | Express sub-router mounting `/kyb` with an injected `kybProvider` | Live |
| [apps/functions/src/wiring/stubs.ts](apps/functions/src/wiring/stubs.ts) | `makeStubOnboardingDeps()` returns a hand-rolled stub `kybProvider` that always approves | **Stub, currently bound at runtime** |
| [apps/functions/src/index.ts](apps/functions/src/index.ts) (line 266) | Builds the onboarding router with `makeStubOnboardingDeps()` | **Stub-wired** |
| [apps/web-admin/src/routes/steps/StepKYB.tsx](apps/web-admin/src/routes/steps/StepKYB.tsx) | Onboarding wizard UI for KYB step — calls `runKyb({ companyId })`, displays "Middesk reference" on success | Live UI, agnostic of provider |
| [.env.example](.env.example) | Declares `MIDDESK_API_KEY=` | Config |
| [.env.local](.env.local) | `MIDDESK_API_KEY` is present but **empty** | Config |
| [docs/TDD.md](docs/TDD.md) §7.1 | Designed integration shape (sketches `makeMiddeskProvider` and a webhook for async completion) | Spec |

Notable absences:
- No `apps/functions/src/webhooks/middesk.ts` exists. The only webhook handler in the repo is `stripe-identity.ts`.
- No `composite.ts` provider (referenced in TDD §4.6) is present.
- No Firestore index / collection specifically for Middesk webhook idempotency.

---

## 2. Real adapter status — `packages/kyb/src/providers/middesk.ts`

### Methods implemented

| Method | Status |
|---|---|
| `verifyBusiness(input)` | **Implemented.** Start + poll + map → `BusinessVerification`. |
| `verifyOfficer(input)` | **Intentionally throws** `MIDDESK_DOES_NOT_HANDLE_OFFICER_KYC` — officer KYC is delegated to Stripe Identity per ADR. |

### Endpoints called

| Method | URL | Purpose |
|---|---|---|
| `POST` | `${baseUrl}/v1/businesses` | Start verification |
| `GET` | `${baseUrl}/v1/businesses/{id}` | Poll until terminal |

`baseUrl` defaults to `https://api-sandbox.middesk.com`. Production URL is documented in the comment as `https://api.middesk.com` but is **not** auto-selected by any env flag — caller must pass `baseUrl` explicitly.

### Request shape (POST body)

```json
{
  "name": "<legalName>",
  "tin": { "tin": "<EIN with hyphens stripped>" },
  "addresses": [{ "state": "<2-letter state>" }]
}
```

No `country` field (Middesk's POST schema doesn't take one; US is implicit). No officers, no DBAs, no website — we send the minimum payload.

### Auth header

`Authorization: Bearer ${apiKey}`. Set on both POST and GET. No `X-Middesk-*` headers, no API version pinning, no `User-Agent`.

### Response shape (subset we read)

From the `MiddeskBusinessResponse` interface in [middesk.ts:51-81](packages/kyb/src/providers/middesk.ts#L51-L81):
`object`, `id`, `status`, `review.{status, completed_at, assignee}`, `name`, `tin.{tin, tin_type}`, `addresses[].state`, `watchlist.{listed, sources[]}`, `sanctions.{listed, matches[]}`, `officers[].{name, titles, sources}`, `tin_status`. Unknown fields are preserved via index signature and pushed into `BusinessVerification.raw` verbatim.

### Polling (no webhook)

- Default `pollIntervalMs: 2000`, `pollTimeoutMs: 90000`.
- Terminal condition (`isTerminal`): `status === "closed"`, OR `review.status` set to anything other than `"open"`, OR `status === "in_audit"`. The "in_audit alone is terminal" rule is a deliberate sandbox concession (review stays open indefinitely in sandbox).
- Sleeps `pollIntervalMs` between GETs; throws `MIDDESK_POLL_TIMEOUT` on deadline.

### Webhook handling

**Not implemented.** No `webhooks/middesk.ts`. TDD §7.1 mentions "Webhook for async completion supported" but the adapter currently relies on synchronous polling only. There is no webhook signature verification, no replay/idempotency handler, no Firestore writeback path triggered by Middesk callbacks.

### Error handling

- Non-2xx on POST → throws `MIDDESK_START_FAILED: ${status} ${text}`.
- Non-2xx on GET → throws `MIDDESK_POLL_FAILED: ${status} ${text}`.
- Timeout → throws `MIDDESK_POLL_TIMEOUT`.
- Missing API key at construction → throws `MIDDESK_API_KEY_MISSING`.
- Missing fetch → throws `MIDDESK_FETCH_UNAVAILABLE`.

The HTTP handler ([kyb.handler.ts:102](apps/functions/src/api/onboarding/kyb.handler.ts#L102)) catches all of the above and returns HTTP 502 `ERR.internal("KYB provider unavailable. Please retry.")`.

### Retry logic

**None.** A single failed POST or a single 5xx during polling aborts the whole call. No exponential backoff. No jitter.

### Rate limiting awareness

**None.** No detection of 429, no `Retry-After` parsing, no client-side limiter.

### Mapping logic — decision matrix

Pulled from `mapToBusinessVerification` ([middesk.ts:194-222](packages/kyb/src/providers/middesk.ts#L194-L222)):

| `review.status` | `ok` |
|---|---|
| `"approved"` | `true` |
| `"rejected"` | `false` |
| `"manual_review"` | `false` |
| missing | derive: `flags.every(f => f.severity !== "high")` |

### Flags extracted

| Flag type | Severity | Source |
|---|---|---|
| `sanctions_match` | high | `sanctions.listed === true` |
| `watchlist_match` | high | `watchlist.listed === true` |
| `ein_not_found` | high | `tin_status === "not_found"` |
| `ein_issue` | medium | `tin_status === "issue"` |
| `name_mismatch` | medium | normalized name comparison vs. submitted `legalName` |
| `manual_review_required` | medium | `review.status === "manual_review"` |

---

## 3. Stub adapter behavior

Two stubs exist — they behave differently.

### A. `packages/kyb/src/providers/stub.ts` — `makeStubKYBProvider`

Used by `@proofline/kyb` unit tests, not by the HTTP API.

Deterministic outcomes:
- **`vendorRef`** = `stub_biz_${sha256(ein).slice(0, 12)}`
- **Rejection rule:** any EIN starting with `"00"` → `ok: false`, flag `sanctions_match` high severity, empty officers.
- **Approval rule:** all other EINs → `ok: true`, no flags, hardcoded officers `[Alice Chen / CEO, Bob Martinez / CFO]`.
- **Latency simulation:** 1800ms ± 300ms jitter via injectable `delay`.
- **`raw.middeskShape`** is a hand-rolled approximation of Middesk's response — close enough to make swapping providers a one-line change at the **package** level. (But: it uses `status: "completed"` and a flat `review_status` field, which doesn't match Middesk's real `status` enum (`open|in_audit|in_review|closed`) or nested `review.status`. The real adapter never sees this, so it doesn't matter — but it's not a perfect mirror.)

### B. `apps/functions/src/wiring/stubs.ts` — inline `stubKybProvider` (lines 130-140)

**This is what the deployed `/v1/onboard/kyb` actually calls today.** It is much dumber:

```ts
async verifyBusiness(input) {
  return {
    ok: true,
    vendorRef: `stub-kyb-${input.ein.replace(/\D+/g, "")}`,
    flags: [],
    officers: [{ name: "Stub Officer", role: "owner" }],
    raw: { stub: true },
  };
}
```

Always approves. One synthetic officer. No latency. No rejection path. **The wizard UI currently can never see a KYB failure from the API.**

### Swap-in honesty

- Inside `@proofline/kyb`: yes, swapping `makeStubKYBProvider` for `makeMiddeskProvider` is a single import + factory-call change because both satisfy the same `KYBProvider` interface.
- Inside `apps/functions`: the handler [redeclares its own local `KYBProvider` interface](apps/functions/src/api/onboarding/kyb.handler.ts#L32-L45) rather than importing from `@proofline/kyb`. The shapes are structurally compatible, so `makeMiddeskProvider()`'s return value will satisfy it, but if/when we add `verifyOfficer` to the handler's expected interface, this duplication will bite us. Worth flagging on the call only if pressed — it's a tidy-up, not a blocker.

---

## 4. End-to-end data flow ("walk me through it")

1. User completes prior onboarding steps (start → DNS → email OTP), company doc reaches `onboardingStatus: "pending_kyb"`.
2. UI: [`StepKYB.tsx`](apps/web-admin/src/routes/steps/StepKYB.tsx) renders the "Run business verification" button. On click → `runKyb({ companyId })` in `apps/web-admin/src/api/client.ts`.
3. HTTP: `POST /v1/onboard/kyb` with `{ companyId }`, Bearer auth.
4. Routing: `publicApp.use("/v1/onboard", corsMiddleware, stubAuthMiddleware, ...)` in [index.ts:270-275](apps/functions/src/index.ts#L270-L275). Note `stubAuthMiddleware` forces `userId: "dev-user"` / `companyId: "dev-company"` — real Firebase Auth is not on this route yet.
5. Router lazily builds via `onboardingRouter()` → `makeOnboardingRouter(makeStubOnboardingDeps())` in [index.ts:263-268](apps/functions/src/index.ts#L263-L268). **This is the injection point that needs to flip to a Middesk-backed deps factory.**
6. Handler: [`kyb.handler.ts`](apps/functions/src/api/onboarding/kyb.handler.ts) validates body, loads company doc via `getCompany(companyId)`, enforces `ownerUserId === userId` and `onboardingStatus === "pending_kyb"`.
7. Provider call: `deps.kybProvider.verifyBusiness({ legalName, ein, state, country: "US" })` — today this is the always-approve stub.
8. Storage: `updateCompany(companyId, { kybResult: { ok, vendorRef, flags, officers, verifiedAt } })`. The full vendor `raw` is **not** persisted by the handler today (the stub returns `raw: { stub: true }` so nothing is lost; with a real adapter this is a gap — see §9).
9. State transition: if `ok === true`, `onboardingStatus` advances to `"pending_kyc"` (Stripe Identity step). If `ok === false`, status → `"rejected"` and the API returns 422 `KYB_FAILED`.
10. Response: `{ ok: true, status: "pending_kyc", vendorRef, officers }`. UI shows officers and "Continue → Officer identity".

**Async webhook completion:** none today. The handler `await`s the provider end-to-end; with the real Middesk adapter, the synchronous request to our API stays open while we poll Middesk for up to 90 s.

---

## 5. Environment + credentials

### Env vars the real Middesk adapter expects

| Var | Used by | Required? |
|---|---|---|
| `MIDDESK_API_KEY` | `makeMiddeskProvider({ apiKey })` | Yes — constructor throws `MIDDESK_API_KEY_MISSING` if empty |
| `MIDDESK_API_BASE` | _Not read anywhere._ Adapter takes `baseUrl` as a config field, defaults to sandbox. We would need to add the env read in whatever factory wires it. | No (defaults to sandbox) |
| `MIDDESK_WEBHOOK_SECRET` | _Not referenced anywhere._ No webhook handler exists. | n/a today |

### `.env.example`

```
MIDDESK_API_KEY=
```

(Plus the Stripe Identity vars — `STRIPE_SECRET_KEY`, `STRIPE_IDENTITY_WEBHOOK_SECRET`.)

### `.env.local`

`MIDDESK_API_KEY`: **present but empty** (verified via length check; value not printed).

### Runtime switch logic for stub vs. real

**There is none.** The only switch is hard-coded in [index.ts:266](apps/functions/src/index.ts#L266):

```ts
cachedOnboardingRouter = makeOnboardingRouter(makeStubOnboardingDeps());
```

No env check, no `isFixtureMode` flag, no DI registry. Flipping to live requires editing this line (or, cleaner, adding a `makeLiveOnboardingDeps()` that branches on `process.env.MIDDESK_API_KEY` presence).

---

## 6. Delta when sandbox keys arrive

### Minimum path to live

1. Drop the sandbox key into `.env.local` as `MIDDESK_API_KEY=<key>`.
2. Add a new factory next to `makeStubOnboardingDeps` — e.g. `makeLiveOnboardingDeps()` — that constructs `makeMiddeskProvider({ apiKey: process.env.MIDDESK_API_KEY!, baseUrl: "https://api-sandbox.middesk.com" })` and keeps the existing stubs for Stripe Identity, KMS, anchor, email until those land.
3. Change [`index.ts:266`](apps/functions/src/index.ts#L266) to call the new factory when `MIDDESK_API_KEY` is set, falling back to stubs otherwise.
4. Deploy the `api` function (`firebase deploy --only functions:api`) — secret needs to be present in the Functions runtime, not just `.env.local`. Either `firebase functions:secrets:set MIDDESK_API_KEY` + `defineSecret(...)` in `index.ts`, or accept that local `.env.local` is for local emulator use only.

### What breaks first if we flip naively

- **Local emulator + remote secret mismatch.** `.env.local` is for local runs; deployed functions read `process.env` from the deploy environment. The current `index.ts` does not call `defineSecret("MIDDESK_API_KEY")`, so even setting it via `firebase functions:secrets:set` will not surface it to the running function until we add the binding (same pattern as `PROOFLINE_AUTH_JWT_SECRET` at [index.ts:38](apps/functions/src/index.ts#L38)).
- **`/v1/onboard` uses `stubAuthMiddleware`**, which lies about `userId` ([index.ts:210-224](apps/functions/src/index.ts#L210-L224)). With a real Middesk call, we will be billing API calls against requests with a forged identity until real Firebase Auth lands on this route.
- **The 90-second poll timeout vs. Firebase Functions request timeout.** The `api` function is declared with default timeoutSeconds (60s) in [index.ts:382-390](apps/functions/src/index.ts#L382-L390). If a Middesk verification stays in `open` for the full 90s poll window, the HTTP function will time out at 60s first. We'd see a client-side 504, not a `MIDDESK_POLL_TIMEOUT`. Fix: either raise the function timeout or accept partial-completion (return 202 + finish via webhook — which we don't have).
- **No raw-response persistence.** Today the handler stores `flags` and `officers` but not `raw`. For audit / re-derivation, we should be writing `kybResult.raw = result.raw` (and reviewing the Firestore rules for PII).

### Smoke test

Once wired:
- Hit `POST /v1/onboard/kyb` with a company whose EIN is one of Middesk's published sandbox EINs (e.g. `00-0000000` — Middesk's documented happy-path sandbox business). The test fake uses `12-3456789` (Acme Corp); against the real sandbox, use whatever EIN their docs publish for the "approved, with officers" scenario.
- Verify response is `{ ok: true, status: "pending_kyc", vendorRef: "biz_...", officers: [...] }`.
- Verify `companies/{id}.kybResult.vendorRef` is set in Firestore and that you can `GET https://api-sandbox.middesk.com/v1/businesses/{vendorRef}` independently with the same key.
- Then re-run with a known-rejection EIN to confirm the 422 / status=rejected path.

---

## 7. Integration concerns for the call

| Concern | What we have today | Gap |
|---|---|---|
| Sandbox vs production URL | Default `baseUrl` is `https://api-sandbox.middesk.com`. No env-selector. | Need an env-driven switch before any prod call. |
| Webhook endpoint deployed + externally reachable | **No Middesk webhook exists.** Only `webhooks/stripe-identity.ts` is mounted under the `webhooks` Cloud Function. | Need to build `apps/functions/src/webhooks/middesk.ts`, mount it on the `webhooks` onRequest export, and register the URL in Middesk's dashboard. |
| Webhook signature verification | n/a — no handler | When built, must follow Middesk's documented signing format (we'd want to ask Peter for canonical signing docs or sample payloads). |
| Status coverage | Adapter understands `review.status ∈ {approved, rejected, manual_review, open}` and `status ∈ {open, in_audit, in_review, closed}`. | `in_review` is in the type but not in `isTerminal()` — only `closed` and `in_audit` are. Worth confirming Middesk's full status enum. |
| Raw vendor response stored | Adapter returns it via `BusinessVerification.raw`; **handler currently does not persist it**. | Persist `raw` to Firestore for audit (and decide PII redaction policy). |
| PII handling in logs | Handler logs `console.error("[kyb] Middesk call failed", err)` — error message can contain Middesk's response body, which may include PII. | Sanitize the logged error before shipping. |
| Idempotency / replay dedup | No webhook → no replay surface yet. The synchronous handler is naturally idempotent on the same `companyId` because the status guard rejects re-submissions (`onboardingStatus !== "pending_kyb"` → 409). | Future webhook needs idempotency keyed on Middesk event ID. |
| Rate limit (429) handling | None. | Add backoff if Middesk's sandbox enforces limits. |
| Tests — unit | 7 cases in `packages/kyb/src/__tests__/middesk.test.ts` against an in-memory FakeMiddesk that asserts URL, Authorization header, POST body shape (`{ name, tin:{tin}, addresses:[{state}] }`), polling cadence, terminal-state detection, sanctions path, name-mismatch + manual-review path, auth failure, missing-key constructor. | No real-sandbox integration test (deliberate — `docs/ARCHITECTURE.md` policy: test suites run with stubs only). |
| Tests — onboarding e2e | `apps/functions/src/api/onboarding/__tests__/onboarding.e2e.test.ts` exercises the handler against the stub provider. | Real-provider e2e doesn't exist. |

---

## 8. Answers I should have memorized

**"Walk me through your KYB integration."**
Onboarding wizard collects legal name, EIN, state. Wizard hits `POST /v1/onboard/kyb` on our Firebase Functions API. The handler loads the pending company, calls a `KYBProvider.verifyBusiness()` adapter, persists the result on the company doc (`kybResult: { ok, vendorRef, flags, officers, verifiedAt }`), then advances onboarding state to `pending_kyc` (Stripe Identity for officer KYC). On `ok: false` we set status `rejected` and return 422. The adapter is `packages/kyb/src/providers/middesk.ts`: POST `/v1/businesses` with `{ name, tin:{tin}, addresses:[{state}] }`, then GET-poll `/v1/businesses/{id}` every 2s until `review.status` is non-open or `status` reaches `in_audit`/`closed`, then map flags (sanctions, watchlist, tin_status, name mismatch, manual_review) and officers into our normalized shape. Today the deployed handler is wired to a stub that always approves — the real Middesk adapter is built, unit-tested, and ready to be wired in `apps/functions/src/index.ts` the moment we have a sandbox key.

**"How are you handling our webhook?"**
Honestly — we aren't yet. The current adapter is poll-only against `/v1/businesses/{id}` with a 90s deadline. We have a precedent for vendor webhooks (the Stripe Identity webhook is live and signature-verified), so adding a Middesk webhook handler is a known-shape task: new route under the `webhooks` Cloud Function, signature verification using your published format, idempotency on the event ID, and a Firestore writeback to the matching company by `vendorRef`. I'd want to align on your webhook signing details on this call.

**"What do you do with the officers list?"**
We surface officers from `BusinessVerification.officers` (name + first title) on the KYB step in the onboarding wizard so the founder can see who's on file. The next step (officer KYC) is Stripe Identity — we use the officers list as the source of expected names to cross-check against the Stripe Identity verification. So Middesk gives us the "who should we be verifying," and Stripe gives us "did that person prove it's them."

**"How do you handle hard flags vs. soft flags?"**
Severity-tagged at extract time. `sanctions_match`, `watchlist_match`, `ein_not_found` are `high` — any one of them forces `ok: false`. `ein_issue`, `name_mismatch`, `manual_review_required` are `medium`. If Middesk has rendered a review verdict (`approved`/`rejected`/`manual_review`) we defer to it. Without a verdict, we derive `ok` as "no high-severity flags". `manual_review` is currently treated as failure in our state machine — that's a deliberate hackathon-grade choice we'd revisit; a manual review queue is on the roadmap (F-ON-07 in PRD).

**"What volume should we expect from you?"**
Early-stage. Onboarding-only — we KYB each company exactly once at signup, no recurring re-screen. Volume will be measured in onboardings, not transactions. (No screening on every wire — that's by design; we're verification infrastructure, not a transaction monitor.) If pressed for numbers: be honest that we're pre-launch and projecting in the low 10s/day in early sandbox testing.

**"Are you calling sandbox or production?"**
Sandbox. The adapter's default `baseUrl` is `https://api-sandbox.middesk.com` and there's no production switch wired today.

**"Is your webhook endpoint deployed and externally reachable?"**
We have a `webhooks` Cloud Function exported (currently hosts Stripe Identity's webhook), so the surface to add a Middesk endpoint is there. There is no Middesk webhook handler on it today.

---

## 9. Honest gaps I should not bluff about

1. **The real adapter is not wired into the deployed API.** `apps/functions/src/index.ts:266` constructs the onboarding router with `makeStubOnboardingDeps()`. The KYB step in the live wizard hits an always-approve stub.
2. **No Middesk webhook handler exists.** No file, no route, no signature verification, no idempotency. We are poll-only.
3. **`stubAuthMiddleware` is on `/v1/onboard`.** Real Firebase Auth is not enforced on the onboarding routes (it is on signing). Until that lands, real Middesk calls would happen under a forged dev identity.
4. **Handler does not persist `raw` vendor response.** Only flags/officers/vendorRef are stored. Audit trail is incomplete for real verifications.
5. **No retry, no 429/backoff, no `Retry-After` handling.**
6. **`MIDDESK_API_BASE` and `MIDDESK_WEBHOOK_SECRET` are not env-wired anywhere.** Need to be added when we flip to live.
7. **Function timeout (60s default) is shorter than the adapter's poll timeout (90s).** First slow verification will surface as a client 504, not a clean `MIDDESK_POLL_TIMEOUT`.
8. **The handler redeclares `KYBProvider` locally** rather than importing from `@proofline/kyb`. Cosmetic for now (structurally compatible), but a duplicated contract.
9. **`in_review` status** appears in the response type but `isTerminal()` only treats `closed` and `in_audit` as terminal. We'd want to confirm Middesk's intended terminal-state semantics.
10. **No production base URL switch.** Default is sandbox; promoting to prod requires an env-driven `baseUrl` and a deliberate code change.
11. **The two stubs (package-level and functions-level) diverge.** The package stub fakes a Middesk-shaped `raw`; the functions stub returns `{ stub: true }`. If anyone is debugging the wizard against the deployed API today, they're looking at the dumber of the two.
12. **No `composite.ts` provider** as described in TDD §4.6 — orchestration of Middesk + Stripe Identity is done by the handler chain, not a composite adapter.

---

## 10. Quick reference card

ProofLine's Middesk integration is a built-and-tested adapter (`packages/kyb/src/providers/middesk.ts`) that POSTs `/v1/businesses` with `{name, tin:{tin}, addresses:[{state}]}` + `Authorization: Bearer ${MIDDESK_API_KEY}`, then GET-polls `/v1/businesses/{id}` every 2s (90s deadline) until `review.status` resolves or `status` reaches `in_audit`/`closed`, mapping into a normalized `BusinessVerification` with severity-tagged flags (`sanctions_match`/`watchlist_match`/`ein_not_found` = high; `ein_issue`/`name_mismatch`/`manual_review_required` = medium) and an officers list. The HTTP entry point `POST /v1/onboard/kyb` ([apps/functions/src/api/onboarding/kyb.handler.ts](apps/functions/src/api/onboarding/kyb.handler.ts)) advances the company's `onboardingStatus` from `pending_kyb` to `pending_kyc` on success or `rejected` on `ok: false`, and the wizard's [`StepKYB.tsx`](apps/web-admin/src/routes/steps/StepKYB.tsx) renders the resulting officers as the expected set for the Stripe Identity step that follows. The real adapter is **not currently wired**: [`apps/functions/src/index.ts:266`](apps/functions/src/index.ts#L266) injects `makeStubOnboardingDeps()` whose KYB stub always approves; flipping to live = (a) populate `MIDDESK_API_KEY` (sandbox default URL), (b) add a `defineSecret` binding in `index.ts` like the existing `PROOFLINE_AUTH_JWT_SECRET` pattern, (c) build `makeMiddeskProvider({ apiKey })` in a live-deps factory, and (d) raise the function timeout above the 90s poll deadline. We have **no Middesk webhook handler today** — Stripe Identity has one, so the pattern exists, but Middesk is poll-only. The adapter is exercised by 7 vitest cases against an in-memory fake (happy/sanctions/name-mismatch/multi-poll/auth-fail/missing-key) — no real-sandbox integration test (project policy: tests run against stubs only). Sales pitch posture: "the contract and the adapter are done; we need your sandbox key plus a webhook spec to finish wiring."
