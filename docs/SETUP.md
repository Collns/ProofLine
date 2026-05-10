# Day Zero — ProofLine setup

Both engineers complete this before starting Phase 2 work.

## Tools
- [ ] Node 20+ installed
- [ ] pnpm 9+ installed (`npm i -g pnpm`)
- [ ] Firebase CLI installed (`npm i -g firebase-tools`)
- [ ] Foundry installed (https://book.getfoundry.sh)
- [ ] Git + GitHub access to Collns/ProofLine

## Accounts (shared 1Password / Bitwarden vault)
- [ ] Firebase project created — both engineers added as Editor
- [ ] Resend API key (sandbox)
- [ ] Middesk sandbox key
- [ ] Stripe test mode keys (secret + identity webhook secret)
- [ ] Sentry project DSN
- [ ] Gemini API key (free tier)
- [ ] Base Sepolia deployer wallet — generate with `cast wallet new`,
      fund via Coinbase faucet
- [ ] GCP project + KMS keyring `proofline-roots` per ADR-0008

## First-time setup
1. Clone the repo
2. Copy `.env.example` to `.env.local` and populate from password vault
3. Run `bash scaffolding/bootstrap.sh` (Git Bash on Windows)
4. When green: pick up a Phase 2 task from the Kanban

## Daily workflow
- Branch off main: `git checkout -b feat/<task-slug>`
- Code, test locally with `pnpm -r --if-present typecheck` and 
  `pnpm -r --if-present test`
- Commit with conventional commits: `feat(crypto): ...`, `fix(...): ...`
- Push, open PR, wait for CI green, squash merge
- Pull main: `git fetch --prune && git checkout main && git pull`

## Help
- Architecture rules: `docs/ARCHITECTURE.md`
- Product spec: `docs/PRD.md`
- Technical spec: `docs/TDD.md`
- Visual reference: `apps/design-prototype/` (run with 
  `pnpm --filter @proofline/design-prototype dev` → localhost:3100)
