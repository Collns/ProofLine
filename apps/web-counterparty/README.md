# `apps/web-counterparty`

The cosign deep-link landing surface — the page Bob taps from his phone
when he gets a cosign-request email. He sees the EXACT wire payload
Sarah signed, runs the F-SIG-09 mandatory pre-biometric verification
checklist, and approves with Touch ID.

This is the demo surface for the §15.3 demo script's T+125s beat.

## Routes

| Path | Component | Purpose |
|---|---|---|
| `/cosign/:messageId` | `CosignLanding` | Main flow — checklist + approve |
| `/cosign/:messageId/success` | `CosignSuccess` | Big green check after finalize |
| `/cosign/:messageId/expired` | `CosignExpired` | JWS exp claim past — offer fresh link |
| `/cosign/:messageId/refresh` | `CosignFreshLink` | F-SIG-10 fresh-link request |
| `*` | `NotFoundPage` | Catch-all |

The link Bob taps is `/cosign/:messageId?t=<JWS>`. URL params are
**never** treated as a source of truth — per F-SIG-09, the surface
re-fetches the canonical envelope from the server before trusting any
of the URL contents.

## The F-SIG-09 / ADR-0010 6-step verification checklist

This is the security guarantee the surface implements. Steps run in
order; the **Approve** button stays disabled until every step passes.

| # | Step ID | Label | What runs |
|---|---|---|---|
| 1 | `decoded` | Cosign request decoded | Parse JWS body client-side; check `exp` not in past |
| 2 | `fetched` | Fetched original message from ProofLine | `GET /v1/cosign/:messageId?token=…`; the server validates JWS signature + `exp` |
| 3 | `recomputed-hash` | Recomputed payload hash | `canonicalize(payload)` → SHA-256 (Web Crypto) |
| 4 | `hash-match` | Confirmed message hasn't been tampered | Recomputed hash == JWS-claimed payloadHash == server-stored payloadHash |
| 5 | `signer-verified` | Verified {signer} signed this exact content | Server returns `ok: true` with non-empty signers, attribution matches |
| 6 | `reviewing` | Reviewing wire details — confirm before approving | Visual gate; user reviews the rendered `WirePayloadCard` |

Per ADR-0010, the surface MUST refuse to fire the WebAuthn assertion
unless all 6 steps pass. The button is `disabled` and a per-step
`failureDetail` renders inline.

## Fixture mode

Fixture mode is on by default in dev (`import.meta.env.DEV`). Override
with `?fixture=<name>`:

| Fixture | URL | Outcome |
|---|---|---|
| `ready` | `/cosign/anything?t=anything&fixture=ready` | All 6 steps pass; approve button enabled |
| `tampered` | `/cosign/anything?t=anything&fixture=tampered` | Step 4 fails; red banner; button disabled |
| `expired` | `/cosign/anything?t=anything&fixture=expired` | Redirects to `/cosign/.../expired` |
| `already-signed` | `/cosign/anything?t=anything&fixture=already-signed` | Terminal "Already cosigned" state |
| `invalid` | `/cosign/anything?t=anything&fixture=invalid` | Server reports JWS sig invalid |

Fixture mode injects synthetic JWS strings via `fixtureJws()` so the
client's `decodeCosignJws` and `runVerifyChecklist` flows execute end-to-end.
Switch to live mode by passing `?fixture=` (empty) and running against
a backend that exposes `/v1/cosign/*`.

## Build / run

```sh
pnpm --filter @proofline/web-counterparty build      # vite build
pnpm --filter @proofline/web-counterparty test       # vitest unit
pnpm --filter @proofline/web-counterparty dev        # vite dev server
```

Local dev gotcha: workspace-wide vitest needs `pnpm -r build` first
(CI builds in topological order). Run `pnpm -r build` once after a
fresh checkout if the type imports from `@proofline/*` fail to resolve.

## What this slice does NOT include (deferred)

- **Server-side cosign endpoint.** `POST /v1/cosign/:messageId/...`
  routes do not exist in `apps/functions/` today. The client expects
  the contract documented in `src/api/types.ts`. **Followup:** land
  the server handlers (token validation, envelope fetch, assertion
  verify, anchor enqueue).
- **Bilateral document flow.** `web-verify` already has a
  `BilateralPage` for the read-only case. Once a bilateral
  *signing* flow is needed in this app, route on `/b/...` to coexist
  with `/cosign/...`.
- **Admin auth on the cosign endpoints.** Per ADR-0010 the JWS itself
  is the auth on `/v1/cosign/*`; no Bearer token is layered on top.
- **E2E tests with real WebAuthn.** Manual smoke covers the demo;
  unit tests cover pure helpers.

## Decisions worth noting

1. **Step 5 trusts the server's verification.** `verifyEnvelope` from
   `@proofline/verification` requires a `RegistryView` (companies/users/
   credentials lookups) which the client doesn't have. The cosign
   surface trusts the server's verified-state response and asserts
   signer attribution match locally. This is the honest trust boundary —
   the alternative (shipping registry data over the wire so the client
   can re-verify cryptographically) is a separate scope.
2. **JWS shape is a working draft.** The exact claim names will be
   pinned when the server endpoint lands (PRD §6.3 F-SIG-08 only
   nails down `exp` semantics). `src/api/types.ts:CosignLinkClaims`
   is the surface's tentative interpretation; expect minor renames.
3. **`canonicalize` runs in the browser.** `@proofline/canonical` is
   isomorphic; the surface uses it directly. Web Crypto `SubtleCrypto`
   provides the SHA-256.
4. **Browser webauthn import.** `@proofline/webauthn` deliberately keeps
   browser helpers off the package index. Mirroring `apps/web-admin`,
   the import path is `@proofline/webauthn/src/browser.js`.
