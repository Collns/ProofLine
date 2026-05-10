#!/usr/bin/env bash
# ProofLine bootstrap — verifies dev environment, installs deps,
# runs typecheck. Run from repo root.
set -euo pipefail

GREEN=$'\033[32m'
RED=$'\033[31m'
RESET=$'\033[0m'

ok()   { printf "%s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
fail() { printf "%s✗%s %s\n" "$RED"   "$RESET" "$1" >&2; exit 1; }

# 1. Tool versions
command -v node     >/dev/null || fail "node not found (need >=20)"
command -v pnpm     >/dev/null || fail "pnpm not found (npm i -g pnpm)"
command -v git      >/dev/null || fail "git not found"
command -v firebase >/dev/null || fail "firebase CLI not found (npm i -g firebase-tools)"
command -v forge    >/dev/null || fail "forge not found (https://book.getfoundry.sh)"
ok "all required tools present"

# 2. Env
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  fail "created .env.local from .env.example — populate values then re-run"
fi

missing=$(comm -23 \
  <(grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort) \
  <(grep -E '^[A-Z_]+=' .env.local   | cut -d= -f1 | sort))
[ -z "$missing" ] || fail "missing keys in .env.local: $missing"
ok ".env.local has all required keys"

# 3. Install + typecheck
pnpm install --frozen-lockfile
ok "pnpm install clean"
pnpm -r --if-present typecheck
ok "typecheck clean"

printf "\n%sBootstrap complete.%s Read docs/SETUP.md for next steps.\n" "$GREEN" "$RESET"
