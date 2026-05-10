# @proofline/web-admin

Onboarding wizard UI for ProofLine (PFL-017).

This is the consumer-facing site that drives a company through the
`/v1/onboard/*` API to a verified, anchored state with a passkey enrolled.

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

* `/`              → redirects to `/onboarding`.
* `/onboarding`    → wizard. The active step is held in component state,
                     not URL — refresh restores from `sessionStorage`.
* `/dashboard`     → post-onboarding landing stub.

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

## Run locally

```bash
pnpm --filter @proofline/web-admin dev      # Vite dev server
pnpm --filter @proofline/web-admin build    # production build
```

The dev server proxies nothing — fixture mode is the offline path.
For real backend dev, run the Firebase emulators alongside and let
the browser hit `/v1/onboard/*` on the local emulator URL via a
reverse proxy or Vite `server.proxy` (not configured in this slice).
