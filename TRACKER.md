# ProofLine — Progress Tracker

> One living file for both of us. The Kanban board (PFL) is still the task list.
> This file answers three questions fast: **where are we vs the architecture**,
> **who's doing what right now**, and **are we ready for the competition**.
>
> **Rules:** update it in the same PR as the work (person or AI; the exact
> steps are in `AGENTS.md`). Add one line to the Log at the bottom. Keep the
> status icons honest. CI's `tracker` check fails code PRs that skip it
> (escape hatch: `skip-tracker` label).
> ✅ done + verified live · 🟡 merged but not deployed/retested · 🔨 in progress · ⬜ not started · ⏸ deferred (post-hackathon)

**Last updated:** 2026-11-28 · `main` @ `4e3d446` · Board: 114 done / 2 in progress / 66 to do
**Team:** Daniel (`dan-od`): deploys, prod secrets, Firestore, passkey taps · Collins: everything else / "either" cards
**Specs:** `docs/PRD.md` (what/why) · `docs/TDD.md` (how) · `docs/architecture/*` (newer plans) · dated snapshots in `docs/status/`

---

## 1. Right now

| Who | Working on | Card | Blocked by |
|---|---|---|---|
| Daniel | Deploy `main` to prod `proofline-cdabb` | PFL-208 | — |
| Daniel | Live Gmail retest of #149/#150/#151 | PFL-209 | PFL-208 |
| Daniel | Prod secrets + third-party accounts | PFL-211 | — |
| Daniel | Stand up staging project | PFL-189 | — |
| Collins | _fill in_ | | |

**Next up (priority order):** PFL-208 → 209 → 211 → 189 → hardening criticals (PFL-168, 170, 172, 173, 174, 177, 178/179) → client resilience (PFL-191–197) → Phase 12 admin + domain (PFL-198–207).

---

## 2. Progress vs architecture

Compared against PRD v3.2 §6 / TDD v3.2. Evidence is from the repo as of the date above.

### Surfaces (apps/)

| Surface | Spec | Status | Notes |
|---|---|---|---|
| Chrome extension (Gmail) | F-EXT-01..09 | 🟡 | Compose detect, toolbar, payload extract, banner inject, send-guard (all send paths incl. Schedule send), inbound badge, session status, wire fields. Latest fixes merged, not deployed (PFL-208/209). Mobile-web Gmail not covered → server-side enforcement PFL-193. |
| web-sign (WebAuthn popup) | F-EXT-08 | ✅ | **Not in PRD layout**: replaces `proofline.app/sign/*`. Passkeys bound to RP `proofline-sign.web.app` (RP migration decision = PFL-205). |
| web-admin (onboarding + dashboard) | F-ON, F-ADM | 🟡 | Onboarding wizard, dashboard, team, settings, invitations. Still has demo/skip buttons → PFL-168/178. Rework planned in `docs/architecture/admin-app-and-domain.md`. |
| web-verify (public verify page) | F-VER-01..07 | ✅ | 4 states incl. suspected spoof; yellow "Test company" banner on Acme until PFL-210. |
| web-counterparty (bilateral portal) | F-BIL-01..09 | 🔨 | Code + automated E2E on main; manual staging E2E blocked by PFL-189 (PFL-146). |
| functions (API) | §12 | 🟡 | Onboarding, sign / sign-silent, sessions, cosign, bilateral, invitations, verify, admin reads. |
| contracts (Anchor.sol) | TDD §6 | ✅ | Deployed on Base Sepolia. Mainnet = PFL-154 ⏸. |
| design-prototype | — | — | Design reference only, not shipped. |

### Core capabilities

| Capability | Spec | Status | Notes |
|---|---|---|---|
| Canonical JSON (RFC 8785) + golden vectors | TDD §4.2 | ✅ | `packages/canonical` |
| Crypto ES256 + Cloud KMS company roots | F-ON-05 | ✅ | KMS provider lives in `packages/crypto/providers/gcp-kms.ts` (`packages/kms` is an empty shell) |
| WebAuthn registration/assertion | F-IAM-02 | ✅ | `packages/webauthn` |
| Onboarding: DNS + email OTP | F-ON-01/02 | ✅ | Real gates + Firebase auth |
| KYB business check | F-ON-03 | 🟡 | **Middesk dropped.** Baselayer / Cobalt behind `KYB_PROVIDER`; real keys need PFL-211 |
| Officer IDV (Stripe Identity) | F-ON-04 | 🟡 | Adapter done; real keys need PFL-211 |
| On-chain anchoring (Merkle → Base Sepolia) | F-ON-06, F-VER-03 | ✅ | |
| Always-on policy pipeline | F-SIG-11 | 🔨 | Pipeline built; still needs Firestore-backed PolicyContext (PFL-172) and hardcoded limits removed (PFL-041) |
| Per-recipient sessions + silent sign | F-SES-01..08 | ✅ | |
| Email signing + sender-domain binding | F-SIG-01..03 | ✅ | Off-domain → `SENDER_DOMAIN_MISMATCH` (PFL-187) |
| Cosign (JWS link + re-verify before biometric) | F-SIG-04..10 | 🔨 | Automated E2E green; manual staging run blocked (PFL-136) |
| Unsigned-send policy (block / warn / allow) | beyond PRD | 🟡 | PFL-188/190: wires always blocked, toast + recipient footer |
| Inline HTML banner (sender-side) | F-VER-08 | ✅ | `packages/email/banner` |
| Inbound badge in Gmail | F-VER-09 | ✅ | |
| Gemini memo screening | F-SIG-06 | ✅ | Advisory, heuristic fallback (PFL-028) |
| Counterparty invitations | F-INV-01..09 | ✅ | Emails sent with onboarding link (PFL-132) |
| Resend transactional email | — | ✅ | Wired at the functions edge |
| Sentry + PII sanitizer | F-ADM-05 | ✅ | |
| Admin session/device revoke | F-ADM-07, F-IAM-04 | ✅ | |
| Policy settings UI | F-ADM-06/07 | 🔨 | Unsigned-email policy exists; TTL/threshold UI still hardcoded (PFL-041) |
| Strict signatures + KMS-signed role creds | TDD §8 | ⬜ | PFL-173, PFL-174 (production criticals) |
| Server-side send enforcement | — | ⬜ | PFL-193 |
| Staging environment | TDD §16 | ⬜ | PFL-189 |
| Outlook web/desktop | F-VER-10 | ⏸ | PFL-152/153, design in `client-resilience.md` |
| Extension bilateral surfaces | F-BIL-10/11 | ⏸ | v1.1 |
| Billing, Base mainnet, website | — | ⏸ | PFL-157, 154, 149–151 |

### Architecture drift (code ≠ docs). Fix the doc or the code.

- `packages/audit`, `kms`, `registry`, `ui` are empty `export {}` shells. Their logic lives in `functions` / `crypto`.
- Middesk is still named across PRD/TDD (F-ON-03, TDD §7.1); the code uses Baselayer / Cobalt.
- `apps/web-sign` exists but isn't in the PRD/TDD repo layout.
- The PRD says WebAuthn RP is `proofline.app`; reality is `proofline-sign.web.app` (PFL-205).
- `docs/adr/` is empty but both specs cite ADR-0001..0014.

---

## 3. Competition brain

**Pitch in one line:** cryptographic signatures on email, right inside Gmail, so a spoofed or tampered wire instruction can't pass as real, and anyone can check the proof on-chain without trusting us.

**Why we win (say these out loud):**
1. Deepfake-proof: hardware passkey signatures, not phone callbacks (CertifID) or account lookups (FundingShield).
2. No workflow change: sign in Gmail, recipient verifies in one click with no install.
3. Provable forever: Merkle root on Base, verifiable even if our servers vanish.
4. Policy at the crypto layer: limits + cosign enforced server-side on every send.
5. Network effect: counterparty invites → bilateral trust.

**Demo readiness (PRD §15.3, 180 s):**

| Beat | Needs | Ready? |
|---|---|---|
| Spoofed email, no badge / suspected spoof | inbound badge, spoof state | ✅ |
| Onboard "Acme Title" live | wizard + anchor | 🟡 demo data reset PFL-210 |
| Invite Scotiabank, streamlined onboard | invitations | ✅ |
| Sarah sends $400k wire → cosign required | wire fields + policy | 🟡 retest after deploy |
| Bob approves on phone with biometric | cosign + web-sign RP | 🔨 PFL-136 |
| Recipient sees banner → verify page green | banner + verify | ✅ |
| Tampered amount → REJECTED | verify | ✅ |
| Basescan anchor | anchoring | ✅ |
| Backup video recorded | — | ⬜ PFL-034 |
| 3 clean rehearsals under 3 min | — | ⬜ PFL-035 |
| Pitch deck | — | ⬜ PFL-033 |

**Competition date / judging criteria:** _fill in_
**Known risks on stage:** Gmail DOM change (pin a tested Gmail state), RP mismatch breaks biometric off `proofline-sign.web.app`, chain/RPC down (use cached tx hashes from demo-prep), "Test company" banner on Acme.

---

## 4. Log (newest first, one line per PR or session)

| Date | Who | What | PR / card |
|---|---|---|---|
| 2026-11-28 | Collins | Ruleset for `main` (`.github/rulesets/main.json`): PR + 1 approval, squash only, required checks | this PR |
| 2026-11-28 | Collins | CI runs only affected tests; prod smoke check; AGENTS.md + tracker check | this PR |
| 2026-11-28 | Collins | Created TRACKER.md from repo + board + 11-26 handoff | — |
| 2026-11-26 | Daniel | Handoff + board reconciliation | #152 |
| 2026-11-21 | Daniel | Send-guard covers Schedule send; popup fixes | #149–#151 / PFL-190 |
