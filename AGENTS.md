# AGENTS.md: instructions for any AI coding assistant

Read by Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Aider and
others. Humans: this is also the short version of how we work.

**ProofLine:** cryptographic signing for B2B email (Chrome extension on Gmail +
Firebase backend + Base Sepolia anchor). Specs: `docs/PRD.md` (what/why),
`docs/TDD.md` (how), `docs/architecture/*` (newer plans). Two people: Daniel
(`dan-od`) owns deploys, prod secrets and Firestore; Collins owns everything else.

## Keep TRACKER.md current (required)

`TRACKER.md` at the repo root is the team's living progress file. Whenever you
make a change that lands in a commit or PR, update it **in the same commit/PR**:

1. **Log:** add one row at the top of section 4:
   `| YYYY-MM-DD | <who> | <what, one line> | #PR / PFL-xxx |`
2. **Status:** if the change moves a feature, flip its icon in section 2
   (✅ done + verified live · 🟡 merged, not deployed/retested · 🔨 in progress ·
   ⬜ not started · ⏸ deferred). Don't mark ✅ unless it was verified live; merged
   code is 🟡.
3. **Right now:** update section 1 if the change finishes or starts a card.
4. **Drift:** if code and PRD/TDD now disagree, add a line under
   "Architecture drift".
5. **Demo:** if it affects a demo beat, update the readiness table in section 3.
6. Bump **Last updated** (date + `main` short SHA if known) at the top.

CI enforces this: the `tracker` check fails a PR that changes code without
touching `TRACKER.md`. For changes that truly don't need it (dependency bumps,
CI-only tweaks), add the `skip-tracker` label to the PR.

## Merging to main

`main` is protected by the ruleset in `.github/rulesets/main.json` (applied in
GitHub → Settings → Rules). Don't try to push to `main` directly; it will be
rejected. Open a PR, which needs 1 approval, resolved review threads, green
`build` / `contracts` / `tracker` checks and an up-to-date branch. Squash
merge only. If you change the ruleset, edit that file in the same PR and
re-import it.

## Working rules

- Branch per card, named after the card ID (`feat/PFL-xxx-short-name`); squash-merge to `main`.
- Commit subjects: `type(scope): summary (PFL-xxx)`.
- Test one package: `pnpm --filter @proofline/<pkg> test` (and `typecheck`).
- Extension: `pnpm --filter @proofline/extension-chrome build`, then reload
  `apps/extension-chrome/dist` unpacked. Chrome doesn't hot-reload it.
- Never deploy, change prod secrets or edit prod Firestore. Those are Daniel's.
- CI only tests packages a change affects (plus their dependents). If you add a
  cross-package import, declare it in that package's `package.json` or CI
  won't know to test it.
