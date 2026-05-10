# ProofLine — Product Requirements Document

**Version:** 3.2 (Email-first, extension-primary)
**Project:** ProofLine — Cryptographic identity layer for B2B financial communications
**Document type:** PRD with design specifications, integrations, and code architecture
**Audience:** Engineering, design, product, stakeholders, AI coding assistants
**Supersedes:** v1.0, v2.0, v3.0, v3.1

---

## Changelog from v3.1

```
FUNDAMENTAL REFRAME
─────────────────────────────────────
The product is no longer "compose wires in a ProofLine
app." It is "ProofLine wraps your existing email client
and signs your messages at send time."

PRIMARY SURFACE
  Was: web app (app.proofline.web.app/compose)
  Now: Chrome extension on Gmail Web (Outlook Web v2)

ADDED
─────
+ F-EXT-01 through F-EXT-09: Chrome extension as primary
  signing surface for outbound email
+ F-SES-01 through F-SES-08: Per-recipient signing
  sessions (15-min sliding TTL)
+ F-SIG-11: ALWAYS-ON POLICY VALIDATION — every signing
  request runs the full policy pipeline server-side
  regardless of session state
+ F-ADM-07: Admin can view/revoke sessions, configure
  session TTL, configure high-value threshold
+ ADR-0012: Email-first compose with Chrome extension
+ ADR-0013: Per-recipient signing session model
+ ADR-0014: Always-on policy validation (no shortcuts)

REFRAMED
─────
~ §6.3 Wire signing → email signing (any email content)
~ §7 User flows → Sarah is in Gmail; extension is the touchpoint
~ §8 Design specs → extension UI components added
~ §10 Code architecture → apps/extension-chrome added,
  apps/web-sender renamed to apps/web-admin
~ §13 Threat model → extended for extension origin

CONFIRMED DEFERRED (post-hackathon)
─────
~ Extension bilateral document surfaces — v1.1 (F-BIL-10/11)
~ Outlook Web extension — v2
~ Outlook desktop add-in — v2
~ Native mobile apps — v2
~ Reply-chain hash linking — v2
~ Attachment signing — v2
~ Stripe Billing
~ FCM push notifications

CARRIED FORWARD UNCHANGED FROM v3.1
─────
✅ All external API integrations
✅ Onboarding flow
✅ Counterparty invitation flow
✅ Cosign workflow (always fresh biometric)
✅ Bilateral document portal
✅ Public verify page
✅ F-VER-07 SUSPECTED_SPOOF state
✅ F-VER-08 sender-side inline HTML banner
✅ ADR-0009 cosign link expiry
✅ ADR-0010 mandatory re-verify before biometric
✅ ADR-0011 email surface strategy
```

---

## Table of Contents

1. Document Control & Purpose
2. Product Summary
3. Problem Statement & Market Opportunity
4. Goals, Non-Goals, Success Metrics
5. Personas & User Stories
6. Product Scope & Feature Requirements
7. User Flows
8. Design Specifications
9. System Architecture
10. Code Architecture & Module Breakdown
11. Data Model & Schemas
12. API Specification
13. Security & Privacy Requirements
14. Performance & Reliability
15. Build Plan & Hackathon Scope
16. Risks & Open Questions
17. Appendix — Glossary

---

## 1. Document Control & Purpose

This Product Requirements Document defines the scope, behavior, design, and engineering plan for **ProofLine**, a cryptographic identity layer for B2B financial communications. The product is delivered primarily as a **Chrome extension that wraps Gmail Web**, with supporting web surfaces for onboarding, admin, public verification, and bilateral document workflows.

| Field | Value |
|---|---|
| Version | 3.2 |
| Status | Approved for kickoff |
| Owners | Product lead, Engineering lead |
| Companion docs | `TDD.md` v3.2, `docs/adr/0001`–`0014`, `PROJECT_OVERVIEW.md`, `GEMINI_REDESIGN_PROMPT.md` |

---

## 2. Product Summary

ProofLine is a cryptographic identity network that prevents wire fraud and impersonation between B2B parties. Operators continue to work in Gmail Web (Outlook Web in v1.1; mobile in v2). A browser extension intercepts outbound email at send time and binds a hardware-backed cryptographic signature to the canonical email content. Recipients see the verification result inline in their inbox via a sender-side HTML banner, or via the extension if they have it installed.

The product consists of:

| Surface | Role | Primary user |
|---|---|---|
| **Chrome extension (Gmail Web)** | Wraps Gmail compose; signs outbound email; renders verification badge on inbound email | Employees, managers — Sarah, Bob |
| **Onboarding & admin web app** | Verifies a company's legal identity, provisions root keys, manages users/devices/sessions/policy | Owners, admins — Alice |
| **Public verification page** | Public, one-click verification of a signed envelope | Recipients — buyers, AP clerks |
| **Counterparty portal** | Bilateral document drafting + reviewing in v1 (extension surfaces deferred to v1.1) | Verified counterparties |

**Strategic positioning:** Cryptographic infrastructure for B2B trust delivered via the email channel operators already use. Wire fraud is the wedge. The network is the moat.

---

## 3. Problem Statement & Market Opportunity

### The Problem

Wire fraud cost businesses **$2.9B in 2023** (FBI IC3, ~15% YoY growth). The dominant attack vector is Business Email Compromise: an attacker spoofs a trusted sender — title company, law firm, escrow agent, vendor — and redirects funds. Recovery rates sit below 30%. AI-era attacks have made the problem worse: voice cloning broke phone-callback verification, deepfake video calls have already extracted eight-figure sums (Arup, $25M, 2024).

### Why an Email-First Approach

Operators do not leave their inbox to verify wires. Closing teams, AP clerks, and finance leaders live in Gmail or Outlook. A verification system that requires switching tools won't be adopted. Meeting users where they already work — inside the email client they open every morning — is the difference between a system that ships and a system that doesn't.

### Market Opportunity

| Segment | Estimate | Notes |
|---|---|---|
| US title insurance firms | ~5,000 firms · $20B revenue | Primary wedge |
| Real-estate law firms | ~30,000 firms (US) | Adjacent buyers |
| Escrow & lender ops | ~10,000 entities | Same closing process |
| Cyber-insurance carriers | Top-20 control >$10B GWP | Distribution partner |
| Enterprise AP departments | All Fortune 5000 | Inbound vendor verification |

### Why Now

AI voice cloning broke phone callbacks. Deepfake video calls have already extracted eight-figure sums. Passkeys reached mainstream adoption (iOS, Android, Chrome, Edge native). Cyber-insurance premiums are spiking; insurers seek technical mitigations. Public-chain L2s (Base, Optimism, Arbitrum) make on-chain anchoring cheap. Browser-extension distribution channels (Chrome Web Store) are mature.

### Competitive Landscape

| Capability | CertifID | FundingShield | ProofLine |
|---|---|---|---|
| Verification method | Phone callback | Account validation | Cryptographic signature |
| Deepfake-resistant | No | Partial | **Yes** |
| Tamper-evident audit | No | No | **Yes (on-chain)** |
| Passkey-native UX | No | No | **Yes** |
| Public anchor — verifiable without trusting vendor | No | No | **Yes** |
| Bilateral counterparty verification | No | No | **Yes** |
| Recipient effort | Phone call | Manual lookup | One click |
| Sender effort | Leave email to verify | Lookup tool | **Sign in Gmail directly** |

---

## 4. Goals, Non-Goals, Success Metrics

### Goals (in scope for v1)

- Prevent BEC-style wire redirection through cryptographic, tamper-evident signing
- Bind every signed email to a hardware-backed device key (Secure Enclave / TPM via WebAuthn)
- Establish bilateral cryptographic trust through structured documents
- Provide one-click recipient verification, no account required
- Enforce organizational policy (role-based limits, co-signing) at the cryptographic layer
- Anchor registry state on a public chain — verifiable without trusting ProofLine
- Make counterparty onboarding a first-class flow
- Deliver compose-time signing through a Chrome extension that works inside Gmail Web with no workflow disruption
- Introduce per-recipient signing sessions to reduce biometric prompts during active conversations without compromising security

### Non-Goals (explicitly out of scope for v1)

- Not preventing insider fraud (signed audit trail is the deterrent)
- Not detecting endpoint malware that swaps account numbers before signing
- Not replacing the underlying email channel; we sign and verify, we do not transport
- Not implementing full bank-side wire interception
- Not building a regulated entity (broker-dealer, MSB)
- Not offering "domain-only" partial verification — false confidence
- Not building Stripe Billing (no customers yet)
- Not building native mobile apps in v1
- Not supporting Outlook in v1 (Gmail Web only)
- Not extension-based bilateral document surfaces (portal handles both sides in v1)
- Not signing email attachments in v1
- Not chain-hashing reply threads in v1

### Success Metrics

| Metric | 90 days | 12 months |
|---|---|---|
| Verified companies | 5 | 150 |
| Counterparties via invitation | 25 | 1,500 |
| **Bilateral coverage** | 20% | 70% |
| Signed emails / month | 1,000 | 200,000 |
| Verify clicks per signed email | ≥ 0.30 | ≥ 0.50 |
| Median time-to-verify | < 5s | < 3s |
| Extension install rate per onboarded user | ≥ 0.85 | ≥ 0.95 |
| Fraction of signed emails using session silent path | n/a (measure) | ≥ 0.50 |
| P0 / P1 security incidents | 0 | 0 |
| Demo-to-pilot conversion | 30% | 50% |
| Insurer LOIs | 1 | 3 |

---

## 5. Personas & User Stories

### Personas

| Persona | Role | Goals | Pains today |
|---|---|---|---|
| Alice (Owner / CEO) | Title or enterprise principal | Enroll, onboard counterparties, manage policy | Liability for fraud; insurer demands |
| Bob (Manager) | Closing ops / AP manager | Approve high-value wires from phone in seconds | Phone callbacks slow & spoofable |
| Sarah (Employee) | Closer / processor | Send signed emails without leaving Gmail | Today emails are unsigned |
| Vendor Vince | Counterparty | Accept invitation, prove identity once, transact safely | Customers don't trust unsigned invoices |
| Buyer | Home-buyer or lender | Trust wire instructions without phoning | No reliable spoof detection |
| Insurer | Cyber-insurance product owner | Reduce loss ratios on BEC claims | Existing controls procedural |

### Representative User Stories

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-1 | owner | verify domain and provision root key in one session | start signing within an hour |
| US-2 | employee | install the ProofLine extension and continue working in Gmail | I don't change my workflow |
| US-3 | employee | tap biometric once per recipient and have follow-up emails sign quickly | the security tax doesn't slow my closings |
| US-4 | manager | approve a wire by tapping a link in my email | high-value wires never block closings |
| US-5 | employee | have the system tell me if my email needs co-sign | I don't accidentally over-send |
| US-6 | buyer | click one link and see who really signed | I'm not tricked by spoofed email |
| US-7 | owner | revoke a lost device immediately | no further emails can be signed from it |
| US-8 | owner | view active sessions and revoke any of them | I can lock things down on compromise |
| US-9 | auditor | fetch a signed history of every email and document | I can prove who authorized what, when |
| US-10 | insurer | subscribe to a feed of signed metadata | underwrite on real signal |
| US-11 | owner | invite my top 50 counterparties to verify themselves | inbound communications become trustworthy |
| US-12 | counterparty | accept invitation and onboard in <10 min | keep doing business with my customer |
| US-13 | AP clerk | receive a signed banking-change request | update records without phone-confirming |
| US-14 | vendor | sign a banking change asynchronously | we don't have to coordinate live |
| US-15 | regulator | independently verify a wire was authorized | I don't need ProofLine to be online or honest |

---

## 6. Product Scope & Feature Requirements

### 6.1 Onboarding & Identity Verification

(Unchanged from v3.1.)

| ID | Requirement | Priority |
|---|---|---|
| F-ON-01 | Domain control via DNS TXT record | P0 |
| F-ON-02 | Email codes to admin@ + postmaster@ via Resend | P0 |
| F-ON-03 | Business KYB via Middesk | P0 sandbox / P1 prod |
| F-ON-04 | Officer IDV via Stripe Identity | P0 sandbox / P1 prod |
| F-ON-05 | Cloud KMS provisions P-256 root key | P0 |
| F-ON-06 | Registry anchored on Base Sepolia | P0 |
| F-ON-07 | Manual review queue for flagged onboardings | P1 |
| F-ON-08 | Streamlined counterparty onboarding tier | P0 |

### 6.2 Identity & Access Management

| ID | Requirement | Priority |
|---|---|---|
| F-IAM-01 | Three roles: owner, manager, employee | P0 |
| F-IAM-02 | Each user enrolls one or more devices via WebAuthn passkey | P0 |
| F-IAM-03 | Each role has per-email and per-day USD authority limits | P0 |
| F-IAM-04 | Owners can revoke any device; managers can revoke employee devices | P0 |
| F-IAM-05 | Revocations propagate to registry within 5 seconds | P0 |
| F-IAM-06 | Lost-device social recovery via M-of-N guardian co-signing | P2 |

### 6.3 Email Signing (rewritten for extension model)

| ID | Requirement | Priority |
|---|---|---|
| F-SIG-01 | Outbound emails composed in Gmail Web are signed at send time by the ProofLine Chrome extension over the canonical email payload (subject, body, To, Cc, Bcc, threadId, timestamp, nonce) | P0 |
| F-SIG-02 | Each signed email carries a 24h validity window via signed `expiresAt` and a unique nonce | P0 |
| F-SIG-03 | Single-sig path when email is not marked as wire instruction OR amount is within signer's authority | P0 |
| F-SIG-04 | Co-sign required when email is explicitly marked as wire instruction above signer's per-email authority OR daily aggregate is exceeded; cosign request via Resend with deep link (F-SIG-08) | P0 |
| F-SIG-05 | Approver biometric-confirms over the exact same canonical payload (always fresh biometric for cosign — no session shortcut) | P0 |
| F-SIG-06 | Memo / body screened by Gemini for social-engineering patterns when wire-instruction mark is set | P1 |
| F-SIG-07 | Signed envelopes stored immutably; audit log append-only | P0 |
| F-SIG-08 | Cosign email links are JWS tokens scoped to one messageId, signed by company root, with `exp` claim per company policy. Default 30 min; configurable post-hackathon (5 min – 24 h hard cap). | P0 |
| F-SIG-09 | Signing surface MUST re-fetch envelope from registry and re-verify `payloadHash` against displayed canonical bytes BEFORE prompting biometric. URL params never trusted as source of truth. | P0 |
| F-SIG-10 | If a cosign link is expired or replayed, signing surface refuses and offers one-tap "request fresh link" that re-emails the eligible approver. | P0 |
| F-SIG-11 | **ALWAYS-ON POLICY VALIDATION.** Every signing request — silent or fresh — runs the FULL policy pipeline server-side: session validation, user-active check, role check, per-email and per-day authority limits, device validation, counterparty status, anomaly heuristics, cosign requirement evaluation. Sessions never shortcut these checks. The session ONLY saves the biometric prompt; it never saves a policy check. | P0 |

### 6.4 Per-Recipient Signing Sessions

| ID | Requirement | Priority |
|---|---|---|
| F-SES-01 | A signing session opens when a user successfully completes a fresh WebAuthn ceremony for a specific recipient (or recipient set in group emails). Scoped to recipient set + user + company. | P0 |
| F-SES-02 | Session TTL: 15 minutes sliding (resets on each successful use), 60 minutes hard cap. Configurable per company in v1.1 (F-ADM-07). | P0 |
| F-SES-03 | Within an active session, extension uses silent WebAuthn assertions (`userVerification: discouraged`) to sign emails to the session's recipient(s) without re-prompting biometric. Each email STILL produces a real WebAuthn assertion bound to the canonical payload. | P0 |
| F-SES-04 | Session record lives server-side in Firestore. Authority belongs to the server. Extension holds a short-lived JWS session token in `chrome.storage.local` (isolated from Gmail's page context). | P0 |
| F-SES-05 | Different recipient (or different recipient set for group emails) = new session = fresh biometric. Cc/Bcc do NOT receive separate sessions; signed payload covers all addresses. Group email sessions are keyed on a sorted-set hash of all To: addresses. | P0 |
| F-SES-06 | Session auto-revokes when: device is revoked, user role changes, user is deactivated, anomaly heuristic fires, hard cap reached, user logs out, admin manually revokes. | P0 |
| F-SES-07 | High-value emails (marked as wire instruction above company's high-value threshold) BYPASS the silent path and ALWAYS require fresh biometric, regardless of session state. | P0 |
| F-SES-08 | Cosign approvals ALWAYS require fresh biometric. No session shortcut for cosign. | P0 |

### 6.5 Verification

| ID | Requirement | Priority |
|---|---|---|
| F-VER-01 | Public verification page renders one of four states: Verified, Bilateral, Suspected Spoof, Rejected | P0 |
| F-VER-02 | Page shows exact email/document details signed plus signer identities | P0 |
| F-VER-03 | Page surfaces on-chain anchor block & tx hash with link to Basescan | P0 |
| F-VER-04 | Verification API endpoint for plugin / programmatic clients | P1 |
| F-VER-05 | Page is mobile-first | P0 |
| F-VER-06 | "Unverified sender" page exists for senders not on ProofLine | P0 |
| F-VER-07 | If a message arrives appearing to be from a verified ProofLine domain but body has no signature, surface as SUSPECTED_SPOOF with explicit warning. Distinct from F-VER-06. | P0 |
| F-VER-08 | Sender-side inline HTML embed: extension injects table-based, inline-styled verification banner at top of outgoing message body. Renders natively in Gmail/Outlook with no recipient install. | P0 |
| F-VER-09 | Recipient-side inline verification badge in Gmail Web: when recipient also has the extension, extension renders richer verification UI in the message header. | P0 |
| F-VER-10 | Outlook Web extension support and Outlook desktop add-in for receiver-side rendering | P2 |

### 6.6 Async Bilateral Verification (Documents)

(Portal handles both drafter and counterparty in v1.)

| ID | Requirement | Priority |
|---|---|---|
| F-BIL-01 | Verified party can draft a bilateral document in counterparty portal | P0 |
| F-BIL-02 | Drafter signs over canonical payload; document state PENDING_COUNTERPARTY | P0 |
| F-BIL-03 | Counterparty receives signed link via Resend; reviews in counterparty portal | P0 |
| F-BIL-04 | Counterparty signs over the SAME canonical bytes; document BILATERAL_SIGNED | P0 |
| F-BIL-05 | Both signatures bound to same payload hash | P0 |
| F-BIL-06 | Documents have configurable expiry (default 14 days) | P0 |
| F-BIL-07 | Either party can revoke before the other signs | P0 |
| F-BIL-08 | Bilateral documents anchored on-chain | P0 |
| F-BIL-09 | Status webhook fires when counterparty signs | P1 |
| F-BIL-10 | Bilateral document drafting via Chrome extension popup (DEFERRED v1.1) | P2 |
| F-BIL-11 | Bilateral document reviewing inline in Gmail/Outlook (DEFERRED v1.1) | P2 |

### 6.7 Counterparty Invitation & Network Growth

| ID | Requirement | Priority |
|---|---|---|
| F-INV-01 | Verified company can invite a counterparty by email | P0 |
| F-INV-02 | Invitation includes contextual messaging | P0 |
| F-INV-03 | Invitee onboards via streamlined flow | P0 |
| F-INV-04 | Invitee onboarding cost can be sponsored by inviter | P1 |
| F-INV-05 | Invitations expire after 30 days | P1 |
| F-INV-06 | Bulk import: invite up to 100 counterparties from CSV | P1 |
| F-INV-07 | Network coverage dashboard | P1 |
| F-INV-08 | Network landing page after onboarding: prominent "invite counterparties" CTA | P0 |
| F-INV-09 | Post-onboarding flow includes "install the ProofLine extension" step with one-click Chrome Web Store link | P0 |

### 6.8 Admin & Observability

| ID | Requirement | Priority |
|---|---|---|
| F-ADM-01 | Owners see a dashboard of users, devices, signed emails, bilateral docs, invitations | P0 |
| F-ADM-02 | Admin can export signed audit bundle | P1 |
| F-ADM-03 | All sensitive actions emit structured audit events | P0 |
| F-ADM-04 | Per-tenant rate-limiting and anomaly detection | P1 |
| F-ADM-05 | Errors reported to Sentry with trace ID | P0 |
| F-ADM-06 | Owners can configure cosign link expiry (5 min – 24 h, default 30 min), bilateral signing window default (1 h – 90 days, default 14 d), per-amount-tier overrides for cosign expiry. v1 hardcoded; v1.1 admin UI. | P1 |
| F-ADM-07 | Owners can view active signing sessions, revoke any session immediately, configure session TTL (5 / 15 / 30 / 60 min, default 15 sliding), configure high-value threshold (default $50,000) above which fresh biometric is always required. v1 hardcoded; v1.1 admin UI. | P1 |

### 6.9 Chrome Extension

| ID | Requirement | Priority |
|---|---|---|
| F-EXT-01 | Manifest v3 Chrome extension distributed via Chrome Web Store | P0 |
| F-EXT-02 | Extension injects "Sign with ProofLine" toolbar control into Gmail Web compose, reply, forward UIs | P0 |
| F-EXT-03 | At send time, extension extracts canonical email payload, posts to ProofLine API, receives signed envelope with inline HTML banner, injects banner at top of email body, allows Gmail to send normally | P0 |
| F-EXT-04 | Extension displays active session status in toolbar | P0 |
| F-EXT-05 | Extension detects inbound emails with ProofLine signatures and renders verification badge in message header (F-VER-09) | P0 |
| F-EXT-06 | User can mark outgoing email as a wire instruction via extension UI; triggers high-value path (always fresh biometric, mandatory amount field, Gemini screening, cosign evaluation) | P0 |
| F-EXT-07 | Extension stores session token and user identity in `chrome.storage.local` (isolated from page JS) | P0 |
| F-EXT-08 | WebAuthn ceremonies happen in popup windows pointing to `proofline.app/sign/*` (correct RP ID origin); extension never holds private key material | P0 |
| F-EXT-09 | Extension auto-detects Gmail DOM changes and surfaces an update notification if injection breaks; falls back gracefully (does not silently send unsigned emails) | P0 |

### 6.10 Anti-features

| Anti-feature | Why excluded |
|---|---|
| Domain-only "partial trust" badges | Typosquats / homograph attacks pass DNS |
| Web-of-trust vouching | Vouches don't auto-expire on compromise (PGP failure mode) |
| Public directory as trust signal | Discovery utility only, never displayed as "verified" |
| Private/permissioned blockchain | Anchoring to a chain we control = our database with extra steps |
| Stripe Billing in v1 | No customers yet |
| FCM push in v1 | Email-based cosign is functionally equivalent |
| Native mobile apps in v1 | Mobile email clients have weak extension APIs |
| Outlook Web extension in v1 | Gmail Web first; Outlook in v1.1 |
| Outlook desktop add-in in v1 | v2 |
| Extension bilateral document surfaces in v1 | Portal handles both sides; v1.1 |
| Reply-chain hash linking | v2 |
| Attachment signing | v2 |
| AI body pattern matching for wire detection | Explicit user mark only — too error-prone |

### 6.11 Environment Variables Manifest

(Unchanged; see `.env.example` in repo bundle.)

---

## 7. User Flows

### 7.1 Company Onboarding

```
[Owner signs up]
   │  Enters: domain · legal name · EIN · officer email
   ▼
[DNS challenge]            ◄── show TXT, poll multi-resolver
   ▼
[Email round-trip]         ◄── Resend → admin@ + postmaster@
   ▼
[Business KYB]             ◄── Middesk
   ▼
[Officer KYC]              ◄── Stripe Identity
   ▼
[Key ceremony]             ◄── Cloud KMS root key
                                + officer's first WebAuthn device
   ▼
[Anchor registry]          ◄── Merkle root → Base Sepolia
   ▼
[Install extension]        ◄── Chrome Web Store one-click
   ▼
[VERIFIED + EXTENSION ACTIVE]
```

### 7.2 Sending a Signed Email — First Email to a Recipient

```
Sarah composes email in Gmail Web to mark@scotiabank-vendor.com
   │  Sarah clicks "Send"
   ▼
Extension intercepts. Checks chrome.storage.local for active
session scoped to mark@... → none found
   │  Extension opens popup → proofline.app/session/start
   ▼
Popup shows email preview + "Sign with Touch ID"
   │  Sarah taps · Touch ID confirms
   ▼
WebAuthn assertion produced over canonical payload hash
   ▼
Server runs F-SIG-11 ALWAYS-ON POLICY PIPELINE:
   ─ role check · authority limits · daily aggregate
   ─ device validation · counterparty status
   ─ anomaly heuristics
   All pass → record signed envelope, create session, return
   sessionToken (15-min JWS) + signed envelope
   ▼
Popup postMessages back to extension
Extension stores sessionToken in chrome.storage.local
Extension injects inline HTML banner at top of Gmail compose
Gmail send proceeds normally
```

### 7.3 Sending a Signed Email — Reply Within Active Session (Silent)

```
Sarah composes reply to Mark within 15 min · clicks Send
   ▼
Extension finds active session for mark@... in chrome.storage.local
   │  Extension calls /api/sign-silent with sessionToken
   ▼
Server runs F-SIG-11 ALWAYS-ON POLICY PIPELINE (full, every time)
   All pass → returns webauthn challenge = sha256(canonical_payload)
   ▼
Extension opens hidden popup → proofline.app/sign/silent
   Popup runs navigator.credentials.get with
   userVerification: "discouraged" → real assertion, no biometric
   ▼
Assertion returned · POSTed to server · validated · envelope recorded
Server extends session.expiresAt by 15 min (sliding window)
   ▼
Extension injects banner · Gmail sends · imperceptible to Sarah
```

### 7.4 Sending a Wire Instruction (Co-Sign Path)

```
Sarah composes email · marks as "wire instruction" via extension UI
   │  Extension reveals required wire fields (amount, account, etc.)
   ▼
Sarah fills · clicks Send
   ▼
Extension calls /api/sign with isWireInstruction=true
Server runs F-SIG-11
   ─ Detects: $400,000 > Sarah's $50,000 limit
   ─ Returns: COSIGN_REQUIRED, eligible_approvers=[Bob]
   ▼
Sarah signs first signature (fresh biometric — F-SES-07 bypasses
   session for high-value)
   ▼
Server queues message PENDING_COSIGN
Resend emails Bob a cosign request with JWS link (F-SIG-08)
   ▼
Bob taps link on phone · cosign deep-link landing surface runs
6-step pre-biometric verification (F-SIG-09)
   ▼
Bob taps "Approve with Face ID" · fresh biometric · second sig
   ▼
Server runs F-SIG-11 again for Bob's signature · all pass
Message released · Resend sends to recipient · banner shows two signers
```

### 7.5 Recipient Verification — Recipient Has Extension

```
Mark receives email in Gmail Web · ProofLine extension installed
   ▼
Extension detects ProofLine signature in message body
Extension calls /api/verify/{messageId}
   ▼
Server verification pipeline:
  1. Fetch envelope · recompute payloadHash · assert match
  2. Verify all signatures
  3. Verify on-chain anchor independently via viem
  4. Check freshness (within expiresAt)
  5. Check policy compliance at signing time
   ▼
Renders verification badge in message header (F-VER-09)
```

### 7.6 Recipient Verification — Recipient Does NOT Have Extension

```
Buyer receives email · no extension
Sees inline HTML banner at top of message body (F-VER-08)
   ▼
Banner is server-rendered by Resend, table-based, inline-styled
   "✓ Verified by ProofLine
    Signed by Sarah Chen at Acme Title (acme-title.com)
    Anchored on Base · Verify the signature →"
   ▼
Buyer clicks Verify → · opens verify.proofline.web.app/{messageId}
Public verify page runs full pipeline · renders ✅ VERIFIED
```

### 7.7 Recipient Verification — SUSPECTED_SPOOF

```
Recipient gets email appearing to be from sarah@acme-title.com
   acme-title.com IS on ProofLine, but THIS email body has no signature
   ▼
If recipient has extension: badge shows "⚠ SUSPECTED_SPOOF" (F-VER-07)
If recipient does not: NO inline banner appears (sender bypassed system)
```

### 7.8 Async Bilateral Document Flow (Portal-Based)

```
Acme's CFO opens counterparty.proofline.web.app
Drafts banking change document · signs via biometric in portal
Status: PENDING_COUNTERPARTY
   ▼
Resend emails Scotiabank's AP a notification with portal link
   ▼
DAY 2 — Mark opens email · clicks portal link
Counterparty portal runs 6-step pre-biometric verification (F-SIG-09)
Mark signs · status BILATERAL_SIGNED · anchored
```

### 7.9 Device Revocation

```
Owner / manager opens admin → Users → device list
Selects device · "Revoke" → confirms with own biometric
   ▼
Revocation event signed · written to registry
ALL active sessions associated with that device auto-revoke
   ▼
User's extension detects revoked session on next API call
Prompts re-authentication · all future verifications referencing
this credential FAIL
```

### 7.10 Counterparty Invitation

```
Alice opens admin → Counterparties → "Invite counterparty"
Pastes 50 vendor emails
Resend sends per-vendor invitations
   ▼
Vendor clicks → streamlined onboarding (DNS + email + Middesk)
Vendor's company verified · root key minted · anchored
   ▼
Vendor prompted to install ProofLine extension (one-click)
Bilateral status established
```

---

## 8. Design Specifications

### 8.1 Brand & Voice

Calm, exact, unflappable — closer to Stripe Atlas than to a consumer crypto app. Copy is short, declarative, never alarmist. Security claims always paired with what was actually checked.

### 8.2 Color System

| Token | Hex | Use |
|---|---|---|
| `color/navy/900` | `#0B1F3A` | Primary brand · headlines |
| `color/blue/600` | `#0D6EFD` | Primary action · links |
| `color/teal/600` | `#0891B2` | Secondary action |
| `color/green/600` | `#0F9D58` | Verified state |
| `color/emerald/700` | `#047857` | Bilateral state |
| `color/amber/700` | `#B45309` | Pending state |
| `color/red/600` | `#D93025` | Rejected / spoof state |
| `color/gray/900` | `#1F2937` | Body text |
| `color/gray/500` | `#6B7280` | Secondary text |
| `color/gray/200` | `#E5E7EB` | Dividers |
| `color/gray/50` | `#FAFAFA` | Surface · zebra |

### 8.3 Typography

Inter for UI; JetBrains Mono for technical (hashes, addresses, JSON). System stack fallback (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`) for embedded inline-HTML banners that must work in any email client.

### 8.4 Component Library

| Component | Spec |
|---|---|
| `VerifyBadge` | Four states: verified · bilateral · suspected_spoof · rejected |
| `EmailPayloadCard` | Subject, recipient, body preview, attachments list (read-only v1) |
| `WirePayloadCard` | Amount, account (last-4 masked), routing, memo — appears when wire-instruction mark is set |
| `BilateralStatusCard` | Both signers, both timestamps, bound payload, expiry countdown |
| `SignerChip` | Avatar + name + role + verification icon |
| `AuthorityMeter` | Amount vs accumulated authority |
| `BiometricPrompt` | Wraps WebAuthn ceremony in popup window · explains what's being signed |
| `AnchorReceipt` | Block number, tx hash, copy-to-clipboard, Basescan link |
| `AuditTrailRow` | Timestamp, actor, action, expandable detail |
| `CounterpartyChip` | Name, verified status, last-active, [Invite] CTA |
| `NetworkCoverageMeter` | % of counterparties verified · trend line |
| `InvitationCard` | Outgoing invite status |
| `SessionStatusChip` | NEW. "🔓 Session active · mark@scotiabank · 12 min left" |
| `SessionListRow` | NEW. Admin: user, recipient scope, opened-at, expires-at, [Revoke] |
| `ExtensionToolbarButton` | NEW. Injected into Gmail compose toolbar |
| `InGmailVerifyBadge` | NEW. Renders in inbound message header for users with extension |

### 8.5 Verification Page Anatomy

(Per ADR-0011, four states: Verified, Bilateral, Suspected Spoof, Rejected.)

### 8.6 Inbox Banner (Sender-Side Embed, F-VER-08)

Table-based, inline-styled HTML. Renders in Gmail/Outlook with no recipient install. Three states (verified, bilateral, suspected_spoof) per ADR-0011.

### 8.7 Extension UI

**Toolbar button in Gmail compose** reveals when clicked:
- "Mark as wire instruction" toggle
- Wire fields (amount, account, routing, memo) — visible only if toggle on
- Session status: "Active for mark@... 12m"
- "Sign and send" button (replaces standard Send)

**Popup ceremony surface (proofline.app/sign):**
- Full-screen takeover, dark navy background
- Email preview byte-for-byte
- "Sign with Touch ID" button
- Footer: session TTL, fresh-link option

**In-Gmail verification badge (inbound):**
- Small chip rendered at top of message header
- States: Verified (green), Bilateral (emerald), Suspected Spoof (red), Rejected (red)
- Click expands to show full verification detail in sidebar

### 8.8 Onboarding Animation

P1 polish item if hour 19+ has slack. (Storyboard unchanged from v3.1 §8.9.)

### 8.9 Accessibility

WCAG 2.2 AA. Focus rings, 4.5:1 contrast, keyboard reachability for every flow including WebAuthn ceremonies. Status colors never the sole signal.

---

## 9. System Architecture

```
┌────────────────────────────────────────────────────────┐
│  GMAIL WEB (mail.google.com)                           │
│  ┌─────────────────────────────────────┐               │
│  │ ProofLine Chrome Extension          │               │
│  │  ─ Content script (Gmail DOM)       │               │
│  │  ─ Background service worker        │               │
│  │  ─ chrome.storage.local             │               │
│  └─────────────────────────────────────┘               │
└──────────────┬─────────────────────────────────────────┘
               │ popup → proofline.app/sign/*
               │ API → proofline.app/api/*
               ▼
┌────────────────────────────────────────────────────────┐
│  PROOFLINE.APP (Firebase Hosting + Functions)          │
│  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐        │
│  │Onboard +│ │Signing │ │Bilateral │ │Verify  │        │
│  │Invite   │ │+Session│ │   API    │ │ API    │        │
│  └────┬────┘ └───┬────┘ └────┬─────┘ └───┬────┘        │
│       └──────────┼───────────┼───────────┘             │
│                  │           │                         │
│             ┌────▼───────────▼────┐                    │
│             │     Firestore       │                    │
│             └──────────┬──────────┘                    │
└────────────────────────┼───────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   External APIs   Google services   On-chain
   ─ Middesk       ─ Cloud KMS       ─ Base Sepolia
   ─ Stripe Identity ─ Gemini API
   ─ Resend
   ─ Sentry
```

### Architectural Principles

- **The on-chain anchor is the trust root, not the database**
- **Cryptography is local** — private keys never leave hardware (Cloud KMS HSM for roots, Secure Enclave / TPM for devices via WebAuthn)
- **The extension never holds private key material** — all WebAuthn ceremonies happen in popup windows on `proofline.app` origin
- **Session tokens isolate** the extension from Gmail's page context (`chrome.storage.local`, not page `localStorage`)
- **Always-on policy validation** — every signing request runs the full pipeline server-side, regardless of session state
- **Verification is stateless and public**
- **Append-only event logs** — envelopes, audit events, revocations, sessions never mutated
- **All third-party APIs accessed through adapters** — Middesk, Stripe Identity, Resend, etc., are swappable

---

## 10. Code Architecture & Module Breakdown

### 10.1 Repository Layout

```
proofline/
├── apps/
│   ├── extension-chrome/   # NEW — Manifest v3 (Gmail Web)
│   ├── web-admin/          # RENAMED from web-sender — onboarding + admin only
│   ├── web-verify/         # public verification page
│   ├── web-counterparty/   # bilateral document portal
│   └── functions/          # Firebase Functions entrypoint
│
├── packages/
│   ├── crypto/             # ECDSA P-256, SHA-256, base64url, secure random
│   ├── canonical/          # RFC 8785 JCS — wires AND email payloads
│   ├── webauthn/           # Browser + server WebAuthn helpers
│   ├── sessions/           # NEW — session lifecycle + JWS tokens
│   ├── policy/             # Role + authority + co-sign + ALWAYS-ON pipeline
│   ├── registry/           # Firestore + on-chain registry adapters
│   ├── anchoring/          # Merkle tree + on-chain anchor + proof verify
│   ├── verification/       # Pure verification algorithm (4 states)
│   ├── bilateral/          # Offer/accept state machine
│   ├── invitations/        # Counterparty invitation lifecycle
│   ├── kyb/                # KYB + IDV adapter interfaces
│   ├── kms/                # Cloud KMS adapter
│   ├── email/              # Resend adapter + inline HTML banner renderer
│   ├── ai/                 # Gemini scam-pattern detection (P1)
│   ├── audit/              # Append-only audit log writer
│   ├── ui/                 # Shared React components + design tokens
│   └── types/              # Shared TypeScript types & zod schemas
│
├── contracts/              # Solidity anchor contract + Foundry tests
├── infra/                  # Terraform / Firebase config
├── docs/                   # ADRs, runbooks, threat model
├── scripts/                # bootstrap.sh, dev tools
└── tools/                  # codegen, fixtures
```

### 10.2 Module Responsibilities (deltas from v3.1)

| Package | Responsibility |
|---|---|
| `@proofline/sessions` | NEW. Session JWS generator + validator, server-side session record CRUD, sliding-window TTL, revocation propagation |
| `@proofline/policy` | EXTENDED. Now includes the ALWAYS-ON validation pipeline. `runPolicyChecks(ctx)` called server-side on every signing request — silent or fresh — returns `Result<Allow, PolicyFailure>` |
| `@proofline/canonical` | EXTENDED. Canonicalizes both wire payloads AND email payloads (subject + body + recipients + threadId + timestamp + nonce) |
| `@proofline/email` | EXTENDED. Resend adapter + inline HTML banner renderer (table-based, inline-styled, three states) |
| `apps/extension-chrome` | NEW. Manifest v3. Content script, background service worker, popup ceremony pages on proofline.app, chrome.storage.local |
| `apps/web-admin` | RENAMED. Onboarding wizard + admin dashboard (users, devices, sessions, policy, audit). NO compose form. |

### 10.3 Adapter Pattern (unchanged)

Every external service is behind an interface in `packages/`. Concrete implementations imported only at the application edge.

---

## 11. Data Model & Schemas

### 11.1 New Firestore Collections

```
sessions/{sessionId}
├── userId, companyId
├── recipientScope: string (sorted-set hash of all To: addresses)
├── primaryRecipient: string (display only)
├── deviceCredentialId
├── authorizedAt, expiresAt, lastUsedAt
├── revoked: boolean, revokedBy, revokedAt
└── highValueOverride: boolean (true if any send exceeded threshold,
                                triggered fresh re-auth)

signed_messages/{messageId}
├── companyId, senderUserId, recipientEmails: [string]
├── canonicalPayload, payloadHash
├── threadId, gmailMessageId
├── isWireInstruction: boolean
├── wirePayload: {amount, recipientAccount, routing, memo} | null
├── signatures: [{signerId, credentialId, sig, signedAt, sessionId}]
├── status, anchorTxHash
└── verifiedBy: [{ip, userAgent, at}]
```

### 11.2 Updated Schemas

```
companies/{companyId}
├── ... (existing fields from v3.1)
└── sessionPolicy: {
      cosignTtlMs: number,            // F-ADM-06
      bilateralTtlMs: number,         // F-ADM-06
      sessionTtlMs: number,           // F-ADM-07, default 15min
      sessionHardCapMs: number,       // F-ADM-07, default 60min
      highValueThresholdUsd: number,  // F-ADM-07, default 50000
      perAmountTiers: [...]
    }
```

### 11.3 Core Type Signatures

```typescript
// packages/types/src/email.ts (NEW)
export const EmailPayload = z.object({
  v: z.literal(1),
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  bcc: z.array(z.string().email()).default([]),
  subject: z.string(),
  body: z.string(),                          // canonical HTML or plain
  threadId: z.string().optional(),
  isWireInstruction: z.boolean().default(false),
  wirePayload: WirePayload.optional(),       // present iff isWireInstruction
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().min(22),
  companyId: z.string(),
});
export type EmailPayload = z.infer<typeof EmailPayload>;

// packages/types/src/session.ts (NEW)
export const SessionToken = z.object({
  v: z.literal(1),
  sessionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  recipientScope: z.string(),    // sorted-set hash
  iat: z.number().int(),
  exp: z.number().int(),
});
```

(WirePayload, BilateralPayload, SignedEnvelope unchanged from v3.1.)

---

## 12. API Specification

### 12.1 Endpoint Catalog (deltas from v3.1)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sessions/start` | Open new signing session via WebAuthn ceremony in popup |
| POST | `/v1/sessions/{sessionId}/extend` | Touch session, extend sliding window |
| POST | `/v1/sessions/{sessionId}/revoke` | Admin revoke or user-initiated logout |
| GET | `/v1/sessions` | Admin list active sessions for company |
| POST | `/v1/sign` | Sign an email — fresh ceremony |
| POST | `/v1/sign-silent` | Sign within active session (silent assertion) |
| POST | `/v1/sign/finalize` | Submit assertion, server validates, records envelope |
| POST | `/v1/extension/auth` | Extension exchanges user login for extension-bound token |

(Existing wires/bilateral/invitations/verify endpoints unchanged.)

### 12.2 Error Model

RFC 7807 problem details. New error codes:
- `SESSION_REVOKED`
- `SESSION_EXPIRED`
- `HIGH_VALUE_REQUIRES_FRESH_BIOMETRIC` (F-SES-07)
- `POLICY_AUTHORITY_EXCEEDED` (F-SIG-11)
- `POLICY_DAILY_AGGREGATE_EXCEEDED` (F-SIG-11)
- `POLICY_COUNTERPARTY_DEACTIVATED`
- `EXTENSION_TOKEN_INVALID`

### 12.3 Rate Limits & Idempotency

(Unchanged from v3.1.)

---

## 13. Security & Privacy Requirements

### 13.1 Threat Model

| Threat | Mitigation |
|---|---|
| Spoofed unsigned email from non-ProofLine sender | Recipients see no badge; extension flags as unverified |
| Mailbox compromise | Cannot forge a signed email. Signing requires WebAuthn device key (Secure Enclave / TPM). F-SIG-09 ensures re-fetch + re-verify before biometric. |
| Spoofed signed-domain message | F-VER-07 SUSPECTED_SPOOF |
| Mid-flight tampering on cosign email link | F-SIG-09 mandatory re-fetch + re-verify |
| Replay of stolen cosign link | JWS `exp` enforced; F-SIG-10 fresh-link flow |
| Stolen device | F-IAM-05 revocation; sessions auto-revoke on device revoke |
| Replay of an old signed email | Server-side nonce + 24h `expiresAt` |
| Fake counterparty | Bilateral verification requires legally verified entities |
| First-contact impersonation | Out-of-band bootstrap; cryptographically secured thereafter |
| Insider fraud | Cannot prevent; signed audit trail enables forensics |
| Compromised registry | Merkle anchoring on Base Sepolia |
| Compromised KMS | Cloud KMS HSM, IAM least-privilege, audit logs, rotation runbook |
| Endpoint malware before signing | Out of scope; recommend dedicated signing devices |
| **Compromised extension running in Gmail** | NEW. Session token in `chrome.storage.local` is isolated from Gmail's page JS. Compromised extension still cannot exceed authority limits (F-SIG-11). Per-recipient session scope limits blast radius. High-value emails always require fresh biometric (F-SES-07). |
| **Stolen session token (e.g. malicious co-installed extension)** | NEW. Tokens are short-TTL JWS (15-min sliding, 60-min cap). Server validates against revocation list on every API call. Admin revoke is immediate. F-SIG-11 still enforces all limits. |
| **Silent WebAuthn bypass attempt** | NEW. Server requires a valid WebAuthn assertion for every signed email — silent or fresh. Session does not replace the assertion; it just allows `userVerification: discouraged`. |
| **Page-level XSS in Gmail injecting a fake send** | NEW. Extension content script runs in isolated world (Manifest v3); Gmail page JS cannot call extension APIs directly. Send interception happens in extension context. |
| **Admin-side session manipulation** | NEW. Admin can revoke but cannot create or modify sessions directly. Session creation requires a valid WebAuthn assertion from the user themselves. Direct DB writes detectable via HMAC integrity checks. |
| Typosquat at onboarding | Levenshtein check + manual review (F-ON-07) |

### 13.2 Honest Limitations

```
⚠  First contact between strangers
   No cryptographic system bootstraps trust between two
   parties who've never interacted.

⚠  Insider fraud
   If the legitimate signer IS the attacker, ProofLine
   signs the fraudulent payload. Audit trail enables
   forensics.

⚠  Endpoint malware before signing
   Malware that swaps account numbers BEFORE the user
   signs is out of scope.

⚠  Silent WebAuthn variance across platforms
   Some platforms (notably iOS Safari) may re-prompt
   biometric within active sessions due to OS-level
   policy. UX trade-off, not a security gap.

⚠  Extension installation friction
   Recipients without the extension still see the
   inline HTML banner, but in-Gmail verification badges
   require install. Network growth + Chrome Web Store
   distribution mitigate over time.
```

### 13.3 Cosign Link Security

(Per ADR-0009 and ADR-0010; unchanged from v3.1.)

### 13.4 Session Security (per ADR-0013 and ADR-0014)

**Server is the authority.** Sessions live in Firestore. Extension holds a JWS-signed session token proving "I am the holder of session X authorized at time Y." Server validates this token AND re-runs the full policy pipeline on every signing request.

**The session ONLY saves the biometric prompt.** It never:
- Grants additional authority
- Skips role checks
- Skips per-email or per-day limits
- Skips device validation
- Skips counterparty status checks
- Skips audit logging

**Silent WebAuthn assertions are still real assertions.** Each silent sign produces a fresh ECDSA signature from Sarah's device, bound to the canonical payload. The session just allows `userVerification: discouraged`.

**Admin powers:** view active sessions, revoke any session immediately, configure TTL, configure high-value threshold. All session-affecting admin actions emit signed audit events.

### 13.5 Privacy

- Session records contain `recipientScope` hash, not plaintext recipient lists, except for display
- Session records purged after 30 days post-expiry
- Extension stores no PII in `chrome.storage.local` beyond user identity and session token
- (All other privacy provisions unchanged from v3.1.)

### 13.6 Compliance Posture (target)

(Unchanged from v3.1.)

---

## 14. Performance & Reliability

### 14.1 SLOs

| Surface | SLO | Notes |
|---|---|---|
| Verification API p95 | < 400ms | Public, must feel instant |
| Verification availability | 99.9% monthly | Powers public trust signal |
| Sign API p95 (fresh) | < 800ms | Includes WebAuthn round-trip |
| Sign API p95 (silent) | < 300ms | NEW. Within active session |
| Session start p95 | < 1s | Fresh biometric ceremony round-trip |
| Anchor confirmation lag | < 10 min | Registry change → on-chain |
| Onboarding finalize median | < 15 min | Excludes manual KYB review |

### 14.2 Observability

- Structured JSON logs with trace IDs
- Errors reported to Sentry
- Metrics: requests, latency, error rate, session creation/revoke rates, silent-vs-fresh ratios, anchor lag, invitation funnel
- Alerts: verify error >1%, silent-sign error >1%, anchor lag >30 min, session revoke spike

### 14.3 Reliability Patterns

(Unchanged from v3.1.)

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

## 16. Risks & Open Questions

### 16.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Two-sided cold start | High | High | Cluster saturation; insurer mandate; counterparty invite |
| Incumbent extends to crypto signing | Medium | High | Move fast on AI-era + on-chain anchor differentiator |
| Regulatory pushback on on-chain | Low | Medium | Anchor only Merkle roots; no PII on-chain |
| Chrome Web Store approval delays | Medium | Medium | Submit early; have unpacked-extension fallback for hackathon |
| Gmail DOM changes break content script | Medium | Medium | F-EXT-09 graceful degradation; pin demo to specific Gmail UI version |
| Manifest v3 service worker quirks | Medium | Medium | Test in clean Chrome profile; document quirks |
| Silent WebAuthn variance | Medium | Low | Document expectations; sessions still reduce prompts dramatically on most platforms |
| KMS / chain outage during demo | Medium | Medium | Pre-anchor demo data; backup video |
| Insurer partnership slower than hoped | Medium | Medium | Parallel-track regulator + direct enterprise sales |

### 16.2 Open Questions

| Question | Owner | Decide by |
|---|---|---|
| Anchor batching cadence | Eng A | Hour 14 |
| Streamlined counterparty KYB depth | Product + Legal | Hour 12 |
| Default session TTL — 15 or 30 min | Product | Pre-pilot |
| Default high-value threshold — $50k or $100k | Product | Pre-pilot |
| Bilateral document types beyond initial three | Product | Post-hackathon |
| Pricing model | Product | Pre-pilot |

---

## 17. Appendix — Glossary

| Term | Meaning |
|---|---|
| BEC | Business Email Compromise |
| KYB | Know-Your-Business |
| IDV | Identity Verification (officer KYC) |
| WebAuthn / Passkey | W3C standard for hardware-backed public-key auth |
| P-256 / secp256r1 | NIST elliptic curve |
| JCS / RFC 8785 | JSON Canonicalization Scheme |
| Merkle anchor | On-chain commitment to a Merkle root |
| Role credential | Signed binding of device key to role + limits |
| Signed envelope | Canonical payload + signatures + role credentials |
| Bilateral document | Payload signed by both parties over same canonical bytes |
| Network coverage | % of a tenant's counterparties that are themselves verified |
| Cluster saturation | Dominating one geography/vertical end-to-end before expanding |
| **Signing session** | NEW. Per-recipient authorization marker (15-min sliding TTL) allowing silent WebAuthn assertions for follow-up emails to same recipient |
| **Silent WebAuthn** | NEW. `userVerification: discouraged` ceremony producing a real assertion without prompting biometric, used within active sessions |
| **Always-on policy validation** | NEW. F-SIG-11 — every signing request runs the full policy pipeline server-side regardless of session state |
| **High-value threshold** | NEW. Configurable per-company amount above which sessions are bypassed and fresh biometric is required (default $50,000) |
| **Recipient scope** | NEW. Sorted-set hash of all To: addresses; uniquely identifies a session's binding to a specific recipient or recipient group |

---

**Document status:** v3.2, email-first + extension-primary. All decisions locked. Companion docs: TDD v3.2, ADRs 0001–0014, PROJECT_OVERVIEW v3.2.
