#!/usr/bin/env bash
#
# Deploy the full ProofLine stack to the STAGING Firebase project.
# See docs/runbooks/staging-deploy.md. Never prints secret values.
#
# Fails before deploying anything if the staging alias, any required env var,
# or any required Functions secret is missing.
set -euo pipefail

ALIAS="staging"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }

fail() { red "✗ $*"; exit 1; }

# ── 0. Tools ──────────────────────────────────────────────────────────────────
command -v firebase >/dev/null || fail "firebase CLI not found (npm i -g firebase-tools)."
command -v pnpm     >/dev/null || fail "pnpm not found."

# ── 1. Staging alias ──────────────────────────────────────────────────────────
if ! firebase use "$ALIAS" >/dev/null 2>&1; then
  fail "No '$ALIAS' Firebase alias. Set it up first — see docs/runbooks/staging-deploy.md §1a."
fi
STAGING_PROJECT="$(firebase use "$ALIAS" 2>/dev/null | tr -d '\n' | sed -E 's/.*\(([^)]+)\).*/\1/')"
[ -n "${STAGING_PROJECT:-}" ] || STAGING_PROJECT="$ALIAS"
info "Staging project: $STAGING_PROJECT"

# Guard against ever pointing this at production.
case "$STAGING_PROJECT" in
  proofline-cdabb) fail "Refusing to run: the '$ALIAS' alias resolves to the production project." ;;
esac

# ── 2. Required env vars ──────────────────────────────────────────────────────
REQUIRED_ENV=(
  PROOFLINE_ENV EMAIL_PROVIDER ANCHOR_PROVIDER KMS_PROVIDER KYB_PROVIDER IDV_PROVIDER AI_PROVIDER
  STAGING_API_BASE STAGING_SIGN_URL STAGING_VERIFY_URL STAGING_ADMIN_URL STAGING_COUNTERPARTY_URL
  STAGING_FIREBASE_API_KEY STAGING_FIREBASE_AUTH_DOMAIN STAGING_FIREBASE_PROJECT_ID
  STAGING_FIREBASE_APP_ID STAGING_FIREBASE_MESSAGING_SENDER_ID STAGING_FIREBASE_STORAGE_BUCKET
)
missing_env=()
for v in "${REQUIRED_ENV[@]}"; do
  [ -n "${!v:-}" ] || missing_env+=("$v")
done
# RESEND_FROM_DOMAIN is required only when actually sending email.
if [ "${EMAIL_PROVIDER:-stub}" = "resend" ] && [ -z "${RESEND_FROM_DOMAIN:-}" ]; then
  missing_env+=("RESEND_FROM_DOMAIN (required when EMAIL_PROVIDER=resend)")
fi
if [ "${#missing_env[@]}" -gt 0 ]; then
  red "✗ Missing env vars:"; printf '    - %s\n' "${missing_env[@]}"
  fail "Set them (see docs/runbooks/staging-deploy.md §3) and re-run."
fi
if [ "$STAGING_FIREBASE_PROJECT_ID" = "proofline-cdabb" ]; then
  fail "STAGING_FIREBASE_PROJECT_ID is the production project."
fi

# ── 3. Required secrets exist on staging (value never read/printed) ───────────
REQUIRED_SECRETS=(
  PROOFLINE_AUTH_JWT_SECRET BILATERAL_JWT_SECRET COSIGN_REFRESH_SECRET
  RESEND_API_KEY STRIPE_SECRET_KEY STRIPE_IDENTITY_WEBHOOK_SECRET
  BASELAYER_API_KEY BASELAYER_WEBHOOK_SECRET COBALT_API_KEY GEMINI_API_KEY
)
missing_secret=()
for s in "${REQUIRED_SECRETS[@]}"; do
  # `secrets:get` reports version metadata only — it never fetches the
  # plaintext (that is `secrets:access`, which we deliberately do not use).
  # Output is redirected regardless so nothing can surface.
  if ! firebase functions:secrets:get "$s" --project "$ALIAS" >/dev/null 2>&1; then
    missing_secret+=("$s")
  fi
done
if [ "${#missing_secret[@]}" -gt 0 ]; then
  red "✗ Missing Functions secrets on '$ALIAS' (set with: firebase functions:secrets:set <NAME> --project $ALIAS):"
  printf '    - %s\n' "${missing_secret[@]}"
  fail "Placeholders are fine on stub providers — see docs/runbooks/staging-deploy.md §2."
fi
grn "✓ Alias, env and secrets present. Nothing above printed any secret value."

# ── 4. Build + deploy Functions ───────────────────────────────────────────────
info "Building + deploying Functions…"
PROOFLINE_ENV="$PROOFLINE_ENV" EMAIL_PROVIDER="$EMAIL_PROVIDER" ANCHOR_PROVIDER="$ANCHOR_PROVIDER" \
  KMS_PROVIDER="$KMS_PROVIDER" KYB_PROVIDER="$KYB_PROVIDER" IDV_PROVIDER="$IDV_PROVIDER" \
  AI_PROVIDER="$AI_PROVIDER" RESEND_FROM_DOMAIN="${RESEND_FROM_DOMAIN:-}" \
  SIGN_APP_URL="$STAGING_SIGN_URL" COUNTERPARTY_PORTAL_URL="$STAGING_COUNTERPARTY_URL" \
  pnpm --filter @proofline/functions build
firebase deploy --only functions --project "$ALIAS"

# ── 5. Build + deploy the four web apps ───────────────────────────────────────
export VITE_API_BASE="$STAGING_API_BASE"
export VITE_FUNCTIONS_BASE_URL="$STAGING_API_BASE"
export VITE_FIREBASE_API_KEY="$STAGING_FIREBASE_API_KEY"
export VITE_FIREBASE_AUTH_DOMAIN="$STAGING_FIREBASE_AUTH_DOMAIN"
export VITE_FIREBASE_PROJECT_ID="$STAGING_FIREBASE_PROJECT_ID"
export VITE_FIREBASE_APP_ID="$STAGING_FIREBASE_APP_ID"
export VITE_FIREBASE_MESSAGING_SENDER_ID="$STAGING_FIREBASE_MESSAGING_SENDER_ID"
export VITE_FIREBASE_STORAGE_BUCKET="$STAGING_FIREBASE_STORAGE_BUCKET"
export VITE_STRIPE_PUBLISHABLE_KEY="${STAGING_STRIPE_PUBLISHABLE_KEY:-}"

info "Building web apps…"
pnpm --filter @proofline/web-admin --filter @proofline/web-sign \
     --filter @proofline/web-verify --filter @proofline/web-counterparty build

info "Deploying hosting…"
firebase deploy --only hosting:admin,hosting:sign,hosting:verify,hosting:counterparty --project "$ALIAS"

# ── 6. Build the extension zip pointed at staging ─────────────────────────────
info "Building extension zip for staging…"
EXT_API_ORIGIN="$STAGING_API_BASE" \
EXT_SIGN_ORIGIN="$STAGING_SIGN_URL" \
EXT_VERIFY_BASE_URL="$STAGING_VERIFY_URL" \
EXT_RP_ID="${EXT_RP_ID:-}" \
  pnpm --filter @proofline/extension-chrome build
ZIP="$ROOT/dist/extension-staging.zip"
mkdir -p "$ROOT/dist"
rm -f "$ZIP"
( cd "$ROOT/apps/extension-chrome/dist" && zip -qr "$ZIP" . )
grn "✓ Extension zip: $ZIP"
if [ -z "${EXT_RP_ID:-}" ]; then
  info "Note: EXT_RP_ID unset → passkey RP stays proofline-sign.web.app. See the runbook's WebAuthn limitation."
fi

grn "✓ Staging deploy complete for $STAGING_PROJECT."
