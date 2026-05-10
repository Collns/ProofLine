# @proofline/web-admin

Owner-facing admin UI for ProofLine. Drives the onboarding wizard
(PFL-017) and the post-onboarding counterparty invitation flow
(PFL-049).

This is the consumer-facing site that drives a company through the
`/v1/onboard/*` API to a verified, anchored state with a passkey enrolled,
then surfaces a dashboard for inviting and tracking counterparties.

## Wizard flow

Nine steps, six numbered in the user-facing progress pill plus three
post-success beats:

| # | Step ID         | API call(s)                               |
|---|-----------------|-------------------------------------------|
| 1 | `intro`         | (none — copy)                             |
| 2 | `company-info`  | `POST /v1/onboard/start`                  |
| 3 | `dns-verify`    | `POST /v1/onboard/verify-dns` (poll)      |
| 4 | `email-verify`  | `POST /v1/onboard/verify-email` + `/verify-email-code` |
| 5 | `kyb`           | `POST /v1/onboard/kyb`                    |
| 6 | `kyc`           | `POST /v1/onboard/enroll-officer` + Stripe Identity modal |
| — | `key-ceremony`  | WebAuthn `navigator.credentials.create` + `POST /v1/onboard/finalize` |
| — | `anchored`      | (renders anchor result from finalize)     |
| — | `extension`     | (Chrome Web Store CTA)                    |

State is held in `src/state/wizard-store.ts` via `useReducer` and
persisted to `sessionStorage` so a page reload mid-flow restores progress.

## Routing

* `/`                   → redirects to `/onboarding`.
* `/onboarding`         → wizard. The active step is held in component state,
                          not URL — refresh restores from `sessionStorage`.
* `/dashboard`          → post-onboarding home: welcome, network coverage
                          meter, recent invitations, and the
                          "Invite counterparties" CTA (PFL-049).
* `/invitations`        → filterable list of every counterparty invite,
                          with resend/cancel actions inline.
* `/invitations/new`    → invite form. Tabs between single-email and
                          bulk-paste (up to 100 emails per submission)
                          modes; supports an optional 280-char message
                          and a "sponsor onboarding cost" toggle
                          (off by default in v1).
* `/invitations/:id`    → single-invitation detail with status badge,
                          timeline (sent → opened → started → verified),
                          and resend/cancel.

The post-onboarding wizard's `extension` step (Skip → Go to dashboard)
already lands on `/dashboard`, where the invitation CTA is the primary
next action — F-INV-08.

## Fixture mode (offline UI dev + demo)

Append `?fixture=happy-path` to any URL:

```
http://localhost:5173/onboarding?fixture=happy-path
```

Every API call returns a synthetic happy-path response with 800 ms of
simulated latency. The Stripe Identity modal is skipped in favor of a
2-second "Document captured" beat. The WebAuthn ceremony is skipped in
favor of a synthesized credential id.

In `import.meta.env.DEV` with no `firebase-id-token` in localStorage,
fixture mode is implicit — useful for offline iteration.

To trip the email-code error path in fixture mode, submit `000000`.

The invitation surfaces (`src/api/invitations-client.ts`) honor the same
`?fixture=happy-path` toggle and ship with ~28 demo invitations spread
across mixed states (12 verified, 14 pending, 2 expired) so the
dashboard, list, and detail pages all render meaningfully without a
backend. The synthetic store mutates within a session — sending,
cancelling, or resending in the UI is reflected on subsequent loads
until you refresh the tab.

URLs that demo well:

```
/dashboard?fixture=happy-path                 # network coverage at 43%
/invitations?fixture=happy-path&status=sent   # pending pile
/invitations?fixture=happy-path&status=accepted
/invitations/inv_001?fixture=happy-path       # accepted detail
/invitations/inv_013?fixture=happy-path       # pending with message
/invitations/inv_027?fixture=happy-path       # expired
/invitations/new?fixture=happy-path           # invite form (single + bulk)
```

## Auth (stubbed)

`src/api/client.ts` reads a Firebase ID token from
`localStorage['firebase-id-token']` and falls back to a placeholder.
The real Firebase Auth flow is a separate ticket
(see `TODO(PFL-AUTH)` in the client).

## Integration points with `apps/functions`

The wizard is a strict consumer of the seven `/v1/onboard/*` endpoints
defined in `apps/functions/src/api/onboarding/router.ts`. Request and
response shapes in `src/api/types.ts` are verified against the handlers'
zod schemas on main.

The invitation surfaces target a `/v1/invitations/*` API that does not
yet exist on the server (`apps/functions/` has zero invitation handlers
as of PFL-049). The shapes in `src/api/invitations-types.ts` mirror
TDD §4.9 `InvitationProvider`. Endpoints the client expects, ready for
a server slice:

| Method | Path                              | Body / query                               |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/v1/invitations`                 | `status, page, pageSize, search`           |
| GET    | `/v1/invitations/:id`             | —                                          |
| POST   | `/v1/invitations`                 | `{ email, sponsoredCost?, message? }`      |
| POST   | `/v1/invitations/bulk`            | `{ emails[], sponsoredCost?, message? }` → `{ created[], skipped[] }` |
| POST   | `/v1/invitations/:id/resend`      | —                                          |
| DELETE | `/v1/invitations/:id`             | —                                          |
| GET    | `/v1/invitations/stats`           | —                                          |

Two contract observations (also called out in the PR description):

1. `POST /v1/onboard/verify-email` sends ONE 6-digit code to
   `ownerEmail`. The wizard collects a single code, not the
   admin@/postmaster@ pair the original spec sketched.
2. `POST /v1/onboard/finalize` does **not** accept a WebAuthn device
   attestation. The owner-device WebAuthn enrollment is referenced in
   `finalize.handler.ts` as a separate `/v1/webauthn/enroll` endpoint,
   which is not yet shipped. The Key Ceremony step runs the
   `navigator.credentials.create` ceremony for the UX beat and stores
   the credential id locally; the actual server-side attestation upload
   is a follow-up ticket.

## Stripe Identity

Reads `VITE_STRIPE_PUBLISHABLE_KEY` from env at runtime via
`src/lib/stripe.ts`. If unset, the KYC step plays a 2-second fallback
beat instead of opening the Stripe modal — the demo still flows. Wire
the publishable key in deployed environments
(see `TODO(PFL-STRIPE)`).

## Tests

```bash
pnpm --filter @proofline/web-admin test     # vitest run
```

Two suites:

* `src/components/__tests__/BulkEmailParser.test.ts` — pure-function
  parser tests (one-per-line, comma/semicolon-separated, whitespace
  handling, dedupe, invalid shapes, BULK_LIMIT cap).
* `src/api/__tests__/invitations-client.test.ts` — fetch-mocked tests
  for query-param encoding, bulk-create response shape, and
  `ApiError` surfacing.

## Run locally

```bash
pnpm --filter @proofline/web-admin dev      # Vite dev server
pnpm --filter @proofline/web-admin build    # production build
```

The dev server proxies nothing — fixture mode is the offline path.
For real backend dev, run the Firebase emulators alongside and let
the browser hit `/v1/onboard/*` on the local emulator URL via a
reverse proxy or Vite `server.proxy` (not configured in this slice).
