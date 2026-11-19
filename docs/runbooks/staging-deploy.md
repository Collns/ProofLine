# Staging deploy runbook

Deploys the whole stack to a **separate** Firebase project so you can run the
PFL-181 and PFL-136 manual tests without touching production
(`proofline-cdabb`). Nothing here prints secret values.

Use `scripts/deploy-staging.sh`. It fails before deploying anything if a
required secret or env var is missing.

---

## 1. One-time setup (do this before the first run)

### 1a. A staging Firebase project
There is **no `staging` alias yet** — `.firebaserc` only has `default`
(`proofline-cdabb`). Create the project and alias:

```bash
firebase projects:create proofline-staging        # or reuse an existing one
firebase use --add                                 # pick the project, name the alias "staging"
```

That writes `"staging": "<project-id>"` into `.firebaserc` under `projects`.
Also add the hosting targets for the staging project (mirror the production
block already in `.firebaserc`), pointing each target at that project's four
Hosting sites:

```bash
firebase target:apply hosting admin        <staging-admin-site>        --project staging
firebase target:apply hosting verify       <staging-verify-site>       --project staging
firebase target:apply hosting counterparty <staging-counterparty-site> --project staging
firebase target:apply hosting sign         <staging-sign-site>         --project staging
```

Create the four Hosting sites first in the Firebase console (Hosting → Add
another site) if they don't exist. Note each site's URL — you'll need them as
the `STAGING_*_URL` env vars below.

### 1b. Enable the APIs the stack uses
On the staging project: Cloud Functions, Secret Manager, Firestore (create the
database, region `us-central1`), and Firebase Auth (enable Google sign-in).

### 1c. Set the Functions secrets (you do this, not the script)
```bash
firebase functions:secrets:set <NAME> --project staging
```
Set every secret in the table below. On stub providers you may store a
placeholder (any non-empty value ≥ the length the config requires); the script
only checks they **exist**, never their value.

---

## 2. Required secrets (Secret Manager, via `functions:secrets:set`)

| Secret | Needed | Placeholder OK on stub? |
|---|---|---|
| `PROOFLINE_AUTH_JWT_SECRET` | always | no — ≥32 random chars |
| `BILATERAL_JWT_SECRET` | always | no — ≥32 random chars |
| `COSIGN_REFRESH_SECRET` | always | no — ≥32 random chars |
| `RESEND_API_KEY` | always bound | yes, while `EMAIL_PROVIDER=stub` |
| `STRIPE_SECRET_KEY` | always bound | yes, while `IDV_PROVIDER=stub` |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | always bound | yes, while `IDV_PROVIDER=stub` |
| `BASELAYER_API_KEY` | always bound | yes, while `KYB_PROVIDER=stub` |
| `BASELAYER_WEBHOOK_SECRET` | always bound | yes, while `KYB_PROVIDER=stub` |
| `COBALT_API_KEY` | always bound | yes, while `KYB_PROVIDER=stub` |
| `GEMINI_API_KEY` | always bound | yes, while `AI_PROVIDER` is `heuristic`/`none` |

The three JWT/refresh secrets must be real even on stub — the API returns 503
without them. For the cosign **email** in PFL-136 you need a real
`RESEND_API_KEY` and `EMAIL_PROVIDER=resend` (see §3).

## 3. Required env vars (exported before running the script)

Runtime provider selection (baked into the Functions bundle at build; the
script passes them through). For a stub-but-emailing staging run, set
`EMAIL_PROVIDER=resend` and the rest to stub:

| Var | Example | Notes |
|---|---|---|
| `PROOFLINE_ENV` | `staging` | required when deployed |
| `EMAIL_PROVIDER` | `resend` | `resend` to actually send cosign/invite email; else `stub` |
| `RESEND_FROM_DOMAIN` | `mail.staging.example` | required when `EMAIL_PROVIDER=resend` |
| `ANCHOR_PROVIDER` | `stub` | `stub` or `base-sepolia` |
| `KMS_PROVIDER` | `stub` | `stub` or `gcp` |
| `KYB_PROVIDER` | `stub` | `stub` / `baselayer` / `cobalt` |
| `IDV_PROVIDER` | `stub` | `stub` / `stripe` |
| `AI_PROVIDER` | `heuristic` | `heuristic` / `gemini` / `none` |

Surface URLs (the script points each build at staging):

| Var | What it is |
|---|---|
| `STAGING_API_BASE` | the staging `api` function origin, e.g. `https://us-central1-<proj>.cloudfunctions.net/api` |
| `STAGING_SIGN_URL` | staging web-sign origin |
| `STAGING_VERIFY_URL` | staging web-verify origin |
| `STAGING_ADMIN_URL` | staging web-admin origin |
| `STAGING_COUNTERPARTY_URL` | staging web-counterparty origin |
| `STAGING_FIREBASE_API_KEY` | staging web app Firebase config (Project settings → Web app) |
| `STAGING_FIREBASE_AUTH_DOMAIN` | e.g. `<proj>.firebaseapp.com` |
| `STAGING_FIREBASE_PROJECT_ID` | staging project id |
| `STAGING_FIREBASE_APP_ID` | staging web app id |
| `STAGING_FIREBASE_MESSAGING_SENDER_ID` | from the web app config |
| `STAGING_FIREBASE_STORAGE_BUCKET` | from the web app config |
| `STAGING_STRIPE_PUBLISHABLE_KEY` | admin officer-IDV UI (test key; blank OK on stub) |

## 4. Run it

```bash
scripts/deploy-staging.sh
```

It preflight-checks the alias, the env vars, and that every secret exists on the
staging project (`firebase functions:secrets:get --project staging`, value never
printed), then builds and deploys Functions and all four web apps and writes the
extension zip at `dist/extension-staging.zip`, built against the staging URLs.

Load the extension zip unpacked in Chrome to test.

---

## Known limitation — WebAuthn passkeys on staging

Passkeys are **bound to the relying-party id `proofline-sign.web.app`** in both
the sign app (`apps/web-sign`, hardcoded) and the server's assertion check
(`expectedRPID` in `sign-finalize` and `cosign-finalize`). A browser will not
use a `proofline-sign.web.app` passkey on a different staging sign domain, so
the **full signing and cosign passkey flow cannot be exercised on a staging
`*.web.app` site as-is.** The extension build does take `EXT_RP_ID`, but the
server and web-sign do not yet, so changing only the extension would fail the
server-side check.

Options for the PFL-181 / PFL-136 passkey steps:
- Serve staging web-sign at `proofline-sign.web.app` via a custom domain mapped
  to the staging site (so the RP matches), **or**
- Make the RP id configurable end to end — tracked as a follow-up — and set it
  on staging and in the server config, **or**
- Run the passkey steps against a production-like environment and use staging
  for the non-WebAuthn paths (config, KYB/IDV stubs, invitations, screening).

Everything that is not a passkey ceremony works on staging as-is.
