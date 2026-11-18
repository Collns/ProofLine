> Archived from PRD v3.2 (2026-11-18): hackathon build plan, demo script and hackathon-era wording removed in PRD v4.0. Kept verbatim for reference; not current requirements.

---

## 15. Build Plan & Hackathon Scope

### 15.1 Day Zero Deliverables

(v3.1 + extension-specific.)

```
☐ Both engineers run scripts/bootstrap.sh
☐ GitHub repo + kanban populated
☐ Firebase project + Editor role for teammate
☐ Cloud KMS keyring `proofline-roots` created
☐ Base Sepolia deployer wallet funded via faucet
☐ All API keys in shared 1Password vault
☐ .env.example committed; .env.local populated
☐ Chrome extension developer mode enabled on both machines
☐ CI green on main with bootstrap commit
```

### 15.2 Hackathon Build Plan (24h)

| Hour | Workstream | Notable deliverables |
|---|---|---|
| 0–2 | Bootstrap | Workspace · CI · Firebase · Anchor.sol skeleton · extension manifest |
| 2–5 | Primitives | crypto · canonical (incl. email payloads) · types · golden vectors · Anchor.sol deployed |
| 5–8 | Identity & onboarding | webauthn · kms · onboarding wizard in web-admin · DNS+email |
| 8–11 | KYB integrations + extension scaffolding | kyb adapters · Middesk + Stripe Identity · extension manifest + Gmail content script |
| 11–13 | **Integration checkpoint — onboarding E2E pass on staging** | |
| 13–16 | Email signing core | policy (always-on pipeline) · sessions · sign endpoint · extension popup ceremony · silent path |
| 16–19 | Signing E2E + verification | Sender-side embed · in-Gmail verify badge · public verify page · session admin (hardcoded TTL) |
| 19–22 | Bilateral portal + cosign + invites + demo data | Counterparty portal · cosign deep link · invitation flow · pre-anchor demo data · slide deck |
| 22–24 | **Joint — rehearse, fix, deploy, record backup video** | |

### 15.3 Demo Script (180 seconds)

```
T+0s    Hook: "$2.9B lost to wire fraud last year. Watch."
T+10s   Live attack: spoofed email arrives in Gmail, no badge
T+25s   Onboard "Acme Title" — animated stepper through DNS →
        Middesk → Stripe Identity → KMS → Base Sepolia anchor
        → install extension
T+50s   Acme invites a partner ("Scotiabank") — onboards live
        in 60 seconds via streamlined flow
T+110s  Sarah composes email in REAL Gmail with extension —
        marks as wire instruction, $400k → blocked, needs
        manager cosign per policy
T+125s  Cosign email arrives on Bob's phone → tap link →
        biometric → both signatures attached
T+140s  Recipient opens email in Gmail · sees green inline
        verification banner · clicks Verify →
        ✅ green page, signers shown, anchor tx linked
T+155s  Attacker tampers with account number →
        ❌ TAMPERED, exact field mismatch
T+170s  Show on-chain Merkle anchor on Basescan —
        "Provable forever, even if our servers vanish"
T+185s  Close: "Phone callbacks die under deepfakes.
        We're not a tool — we're cryptographic infrastructure
        for the AI era, delivered where operators already work."
```

---

## Other v3.2 passages replaced in v4.0 (verbatim)

### Changelog from v3.1 — deferred-items heading

```
CONFIRMED DEFERRED (post-hackathon)
```

### §4 Success Metrics — removed row

| Metric | 90 days | 12 months |
|---|---|---|
| Demo-to-pilot conversion | 30% | 50% |

### §6.3 F-SIG-08 (original wording)

| ID | Requirement | Priority |
|---|---|---|
| F-SIG-08 | Cosign email links are JWS tokens scoped to one messageId, signed by company root, with `exp` claim per company policy. Default 30 min; configurable post-hackathon (5 min – 24 h hard cap). | P0 |

### §8.8 Onboarding Animation (original wording)

P1 polish item if hour 19+ has slack. (Storyboard unchanged from v3.1 §8.9.)

### §16.1 Risks — original rows

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Chrome Web Store approval delays | Medium | Medium | Submit early; have unpacked-extension fallback for hackathon |
| Gmail DOM changes break content script | Medium | Medium | F-EXT-09 graceful degradation; pin demo to specific Gmail UI version |
| KMS / chain outage during demo | Medium | Medium | Pre-anchor demo data; backup video |

### §16.2 Open Questions — original rows

| Question | Owner | Decide by |
|---|---|---|
| Anchor batching cadence | Eng A | Hour 14 |
| Streamlined counterparty KYB depth | Product + Legal | Hour 12 |
| Bilateral document types beyond initial three | Product | Post-hackathon |
