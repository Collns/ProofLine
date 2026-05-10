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

## Foundry / on-chain setup

Foundry runs in WSL on Windows. After clone, both engineers run from 
WSL inside the contracts/ directory:

    cd /mnt/c/<path-to-repo>/contracts
    forge install foundry-rs/forge-std
    forge build
    forge test

All forge tests should pass green. The deployed Anchor contract 
address is stored in .env.local as ANCHOR_CONTRACT_ADDRESS — fill 
this in after running the deploy script (PFL-008).

## Help
- Architecture rules: `docs/ARCHITECTURE.md`
- Product spec: `docs/PRD.md`
- Technical spec: `docs/TDD.md`
- Visual reference: `apps/design-prototype/` (run with 
  `pnpm --filter @proofline/design-prototype dev` → localhost:3100)

## Deployed Contracts

### Base Sepolia (testnet, current)

| Contract | Address | Deploy Block | Tx |
|---|---|---|---|
| ProofLineAnchor | `0x079D64345af444Bc4cd89a298A00f8E5e302d7D0` | 41312740 | [view on Basescan](https://sepolia.basescan.org/tx/0xfe9d4e1ef70b109bac72ba08633e12846f49e1fc661805f84d119cb7b4f40549) |

The deployer key is the contract owner and the only address authorized to call `anchorRoot()`. Engineers fetch the deployer key from the team's shared vault (1Password) and add the following to `.env.local`:
ANCHOR_CONTRACT_ADDRESS=0x079D64345af444Bc4cd89a298A00f8E5e302d7D0
ANCHOR_CHAIN_ID=84532
ANCHOR_DEPLOY_BLOCK=41312740
ANCHOR_DEPLOY_TX=0xfe9d4e1ef70b109bac72ba08633e12846f49e1fc661805f84d119cb7b4f40549
DEPLOYER_PRIVATE_KEY=<from 1Password>
BASE_SEPOLIA_RPC=https://sepolia.base.org

**DO NOT redeploy.** This on-chain address is canonical for the team.