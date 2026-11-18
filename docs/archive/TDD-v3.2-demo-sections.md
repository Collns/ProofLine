> Archived from TDD v3.2 (removed in v4.0). Kept verbatim for reference; not part of the current design.

---

## From §6 On-Chain Anchor Contract

### 6.3 Demo Anti-Failure Plan

```
30 min before demo:
  ─ All "test fixture" companies pre-onboarded and anchored
  ─ All "test wire" envelopes pre-signed and anchored
  ─ Anchor tx hashes recorded in demo notes
  ─ One "live anchor" reserved for the climactic beat

If chain or RPC fails on stage:
  ─ Switch to cached tx hash from rehearsal
  ─ Narrate: "in production this anchors every N minutes"
```

---

## From §16 Deployment Topology

### 16.1 Hackathon

```
                  ┌────────────────────┐
                  │  Firebase Hosting   │
                  │  *.web.app          │
                  │   sender, verify,   │
                  │   counterparty      │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Firebase Functions │
                  │   (us-central1)    │
                  └─────────┬──────────┘
                            │
       ┌─────┬─────┬────────┼────────┬─────┬──────┐
       ▼     ▼     ▼        ▼        ▼     ▼      ▼
   Firestore  KMS  Middesk  Stripe  Resend Sentry Base
                            Identity                Sepolia
```

Single region, single project, free tiers. ~$0/month at demo volume.

### 16.2 Production (post-hackathon)

```
+ Multi-region failover for Functions + Firestore
+ Cloud KMS in dedicated keyring with IAM least-privilege
+ Migrate anchoring from Base Sepolia to Base mainnet
+ Cloud Armor / WAF in front of public verification endpoints
+ Secret Manager for all credentials (replaces .env)
+ Cloud Trace + Cloud Monitoring + Sentry alerting
+ SOC 2 audit prep
```

---

## Document status line (end of v3.2)

**Document status:** v3.0, integration-ready. Implementation should follow this document for the *how*; refer to PRD v3.0 for the *why*. Begin Day Zero per `scaffolding/bootstrap.sh`.
