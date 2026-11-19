# ProofLine — Technical Design Document

**Version:** 4.0 (Production plan — extension-first product, production hardening)
**Companion to:** PRD.md v4.0
**Audience:** Engineers, reviewers
**Scope:** Implementation details, contracts, integrations, configuration, deployment
**Supersedes:** v3.0, v3.1, v3.2

---

## Changelog v3.2 → v4.0

```
v4.0 — PRODUCTION PLAN
──────────────────────
ProofLine moves from a time-boxed prototype to a
production product. This revision aligns the TDD with
the code on main (reconciled 2026-11-18) and defines
what production requires.

ADDED
─────
+ §2.1 Implementation status — what is built, what is
  partial, what is not built (reconciled with code)
+ §7.0 Provider selection — env-driven provider slots
  for KYB, IDV, email, anchoring, KMS
+ §17 Production Requirements & Configuration —
  config module, PROOFLINE_ENV, provider env table,
  secrets via Functions defineSecret (no fallback),
  auth matrix per route group, no demo paths in prod
  builds, verification strictness, manual review

CHANGED
───────
~ KYB vendor: Middesk dropped (sales-gated sandbox).
  Baselayer is primary, Cobalt Intelligence fallback
  (§2, §3, §4.6, §5.1, §7.1, §14, §16)
~ §7.1 rewritten around the Baselayer adapter, env
  selection, async webhook for tin_pending, Cobalt
  fallback, stub behaviour, manual review routing
~ §7.2 Stripe Identity described as adapter-ready
  behind IDV_PROVIDER
~ KYB / IDV status: adapter-ready, running on stub
  pending vendor access; stub-verified companies
  require manual review
~ §16 Deployment topology describes the current
  deployment and the production delta
~ §4.6 lists the provider files that actually exist
  (no composite provider)

REMOVED (archived verbatim to
docs/archive/TDD-v3.2-demo-sections.md)
─────────
- §6.3 time-boxed presentation failure plan
- §16.1 prototype deployment topology
- Bootstrap / "Day Zero" status line
```

## Changelog v3.0 → v3.2

```
v3.2 — EMAIL-FIRST PIVOT
────────────────────────
The compose surface moves from a ProofLine web app to
a Chrome extension that wraps Gmail Web. This changes
parts of the system materially:

ADDED
─────
+ §3.2 Surface architecture — extension primary, web
  apps supporting
+ §4.10 @proofline/extension package contracts
+ §4.11 @proofline/sessions package contracts
+ §5.5 Sequence diagram — session establishment via popup
+ §5.6 Sequence diagram — silent in-session signing
+ §5.7 Sequence diagram — session revocation
+ §11.4 Per-recipient signing session lifecycle (full)
+ §11.5 Always-on policy validation pipeline (the rule
  that sessions never bypass)
+ §11.6 Extension origin isolation + chrome.storage
  security model
+ §14.6 Extension build/deploy pipeline (Manifest v3,
  Chrome Web Store)

REFRAMED
────────
~ §3 System architecture — extension is now the
  compose touchpoint
~ §10 Repo layout — apps/extension-chrome added,
  apps/web-sender becomes apps/web-admin
~ §11 Auth — session model is per-recipient, not
  per-app

UNCHANGED
─────────
✅ All cryptographic primitives (§4.1, §4.2, §8)
✅ All external integrations (§4.6, §4.7, §4.8, §7)
✅ On-chain anchor contract (§6)
✅ Verification algorithm (§9)
✅ Bilateral document portal architecture (§4.4)
✅ Onboarding integration sequence (§5.1)
✅ Cosign deep-link mechanics (§5.2)
```

---

## 1. Document Purpose

This TDD complements the PRD. The PRD answers *what* and *why*; this document answers *how*. Where they overlap, the PRD wins on intent and this document wins on mechanics.

Read alongside:
- `docs/PRD.md` v4.0 — product requirements
- `docs/adr/0001`–`0014` — individual architectural decisions
- `scaffolding/` — bootstrap script, env manifest, config templates

---

## 2. Architectural Tenets

```
┌──────────────────────────────────────────────────────────┐
│  TENET                          CONSEQUENCE              │
├──────────────────────────────────────────────────────────┤
│ Math is the trust root,    →   Public-chain anchor;      │
│ not us                          verification works without│
│                                 us                        │
│                                                          │
│ Private keys never leave   →   Cloud KMS HSM for roots;  │
│ hardware                        Secure Enclave for devs  │
│                                                          │
│ Verification is pure       →   No I/O in the algorithm   │
│                                                          │
│ Append-only event logs     →   Wires, bilateral docs,    │
│                                 revocations, audit       │
│                                                          │
│ Adapter pattern for        →   KYB, IDV, email, chain,   │
│ external services               KMS env-selected         │
│                                                          │
│ Fail closed in production  →   No silent stub fallback;  │
│                                 missing config = no boot │
│                                                          │
│ Time and randomness        →   Tests don't depend on     │
│ are injected                    now() or Math.random()   │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Implementation Status (reconciled with `main`, 2026-11-18)

Status values: **Built** (real, in the production path) · **Partial** (real but with a known gap) · **Adapter-ready (stub)** (adapter code exists; edge runs a stub) · **Not built**.

| Area | Status | Notes |
|---|---|---|
| Extension sign flow (Gmail compose Sign button, popup WebAuthn ceremony, server-issued challenges, WebAuthn verification) | Built | `/v1/sign`, `/v1/auth/challenge` |
| Extension auth + multi-device | Built | `/v1/extension/auth`, per-device validation and revocation (PFL-085) |
| Sessions + silent signing path | Partial | Session-token key is generated per process; tokens only verify on the issuing instance (PFL-172) |
| Always-on policy pipeline (§11.6) | Partial | Runs on every sign; `PolicyContext` is partly in-memory with default company policy (PFL-172); limits hardcoded (PFL-041) |
| Verify API + public verify page | Built | `/v1/verify` |
| Inbound verification badge in Gmail | Built | verified / bilateral / suspected_spoof / rejected / unverified_sender + sidebar (PFL-048) |
| Company root keys in Cloud KMS | Built | PFL-126 |
| Anchoring on Base Sepolia | Built | PFL-114; mainnet deferred |
| Admin dashboard (Firebase Auth: users, devices, sessions, user management) | Built | PFL-120..130 |
| Employee invitations | Built | PFL-068 |
| Firestore security rules | Built | PFL-122 |
| Cosign flow | Built (server + web-sign) | PFL-062/171/136: signed link tokens, verified cosigner assertion + eligibility, approval page on web-sign; extension auto-release after approval is a follow-up |
| Bilateral API + state machine | Partial | PFL-024/025; route group on stub auth (PFL-166) |
| Onboarding API | Partial | Stub auth (PFL-166); `demoMode` finalize bypass (PFL-167) |
| Business KYB (Baselayer / Cobalt) | Adapter-ready (stub) | adapter-ready, running on stub pending vendor access; stub-verified companies require manual review |
| Officer IDV (Stripe Identity) | Adapter-ready (stub) | adapter-ready, running on stub pending vendor access; stub-verified companies require manual review |
| Outbound email (Resend) | Not built (wiring) | Adapter exists in `packages/email`; functions send no email yet (PFL-160) |
| Wire-instruction marking UI | Not built (wiring) | `content/wire-fields.ts` exists, not mounted (PFL-135) |
| Counterparty invitations | Not built | Backend missing; admin UI on fixtures (PFL-026 / PFL-132) |
| Gemini memo screening | Not built | `packages/ai` is empty (PFL-028) |
| Block Gmail Send on sign failure | Not built | No Send interception (PFL-096) |

---

## 3. System Architecture

```
   ┌──────────────────┐  ┌──────────────┐  ┌─────────────┐
   │ Chrome Extension │  │ Counterparty │  │  Recipient  │
   │ on Gmail Web     │  │   Portal     │  │   Browser   │
   │  (PRIMARY        │  │  (bilateral  │  │  (verify    │
   │   compose +      │  │   docs)      │  │   page,     │
   │   inbound badge) │  │              │  │   public)   │
   └─────┬────────────┘  └──────┬───────┘  └──────┬──────┘
         │                      │                  │
         │  popup ┌──────────────────────┐         │
         ├──────▶ │ proofline.app/sign/* │         │
         │        │  (WebAuthn ceremony  │         │
         │        │   origin — RP ID)    │         │
         │        └──────────┬───────────┘         │
         │ HTTPS             │ HTTPS               │ HTTPS
         ▼                   ▼                     ▼
   ┌────────────────────────────────────────────────────┐
   │           Firebase Hosting + Functions             │
   │                                                    │
   │   ┌──────────┐ ┌────────┐ ┌──────────┐ ┌────────┐  │
   │   │Onboard + │ │Signing │ │Bilateral │ │ Verify │  │
   │   │Invite API│ │ + Sess │ │   API    │ │  API   │  │
   │   │          │ │  API   │ │          │ │        │  │
   │   └────┬─────┘ └───┬────┘ └────┬─────┘ └───┬────┘  │
   │        └───────────┼───────────┼───────────┘       │
   │              ┌─────▼───────────▼─────┐             │
   │              │      Firestore        │             │
   │              │  (incl. sessions/*)   │             │
   │              └──────────┬───────────┘              │
   └─────────────────────────┼──────────────────────────┘
                             │
       ┌─────────┬──────┬────┼──────┬────┬─────────┐
       ▼         ▼      ▼    ▼      ▼    ▼         ▼
   ┌────────┐┌──────┐┌──────┐┌──────┐┌────┐┌─────────┐
   │ Cloud  ││Stripe││Base- ││Resend││Sen-││  Base   │
   │ KMS    ││ID    ││layer ││      ││try ││  Sep.   │
   └────────┘└──────┘└──────┘└──────┘└────┘└─────────┘

   Web admin app (app.proofline.web.app) used for:
    ─ Onboarding wizard (DNS, KYB, Stripe IDV, KMS)
    ─ Admin dashboard (users, devices, sessions, wires,
      bilateral docs, invitations)
    ─ Counterparty invitation management
    ─ Session admin (view, revoke, configure)
   NOT used for: drafting/signing emails (extension does this)

   Provider boxes are env-selected slots (§7.0, §17):
    ─ Baselayer = KYB slot (Cobalt Intelligence fallback)
    ─ Stripe ID = IDV slot
    ─ Both run on stub today pending vendor access
```

### 3.2 Surface Architecture

```
┌──────────────────────────────────────────────────────────┐
│         FOUR DISTINCT SURFACES                           │
└──────────────────────────────────────────────────────────┘

  CHROME EXTENSION (PRIMARY — apps/extension-chrome)
  ──────────────────────────────────────────────────
  Where:    Gmail Web (mail.google.com)
  Origin:   chrome-extension://<id>/* (content script
            runs in isolated world inside Gmail's page)
  Role:     Compose-time signing, inbound verification
            badge rendering, session status indicator
  Storage:  chrome.storage.local (isolated from Gmail
            page JS)
  WebAuthn: Delegated to popup on proofline.app/sign/*

  SIGN APP (apps/web-sign)
  ──────────────────────────────────────────────────
  Where:    proofline-sign.web.app
  Role:     WebAuthn ceremonies: passkey registration,
            sender signing popup (/sign/start, /sign/silent),
            internal cosign approval (/cosign/:messageId)
  Auth:     Passkeys are registered for RP ID
            proofline-sign.web.app, so every ceremony that
            uses them runs on this origin

  WEB ADMIN APP (apps/web-admin)
  ──────────────────────────────────────────────────
  Where:    app.proofline.web.app
  Role:     Onboarding, admin dashboard, session
            controls, counterparty invites
  Auth:     Firebase Auth + WebAuthn for sensitive
            actions

  COUNTERPARTY PORTAL (apps/web-counterparty)
  ──────────────────────────────────────────────────
  Where:    counterparty.proofline.web.app
  Role:     Bilateral document review + signing
            (drafter and counterparty sides)
  Auth:     JWS-signed deep link from notification
            email + WebAuthn for signing

  PUBLIC VERIFY PAGE (apps/web-verify)
  ──────────────────────────────────────────────────
  Where:    verify.proofline.web.app
  Role:     Public verification of any signed envelope
  Auth:     None — fully public, read-only
```

### 3.3 Trust Boundaries

```
   Public network        (browsers, email, attackers)
   ─────────────────────────────────────────────────
   Gmail page DOM        (mail.google.com origin —
                          UNTRUSTED for ProofLine state)
   ─────────────────────────────────────────────────
   Extension content     (isolated world; trusted to
   script + bg worker    extract email + render badges)
   ─────────────────────────────────────────────────
   chrome.storage.local  (isolated from page; holds
                          session token, user identity)
   ─────────────────────────────────────────────────
   Popup on proofline.app (correct WebAuthn RP ID;
                           trusted ceremony surface)
   ─────────────────────────────────────────────────
   Verification API endpoint (read-only, public)
   ─────────────────────────────────────────────────
   Web admin / counterparty portal (auth + WebAuthn)
   ─────────────────────────────────────────────────
   Firebase Functions    (server, IAM-gated)
   ─────────────────────────────────────────────────
   Firestore + KMS + 3rd-party APIs (server-only writes)
   ─────────────────────────────────────────────────
   Public chain          (immutable once confirmed)
```

The verification API talks to Firestore for read-only views and to Base Sepolia RPC for anchor proof. It cannot mutate registry state. Even a compromised verification function cannot rewrite history.

The Gmail page DOM is **explicitly untrusted**. The extension's content script reads the compose body (subject, body, To/Cc/Bcc) but never trusts that DOM for authoritative state — every signed payload is canonicalized and hashed, and the hash is what's signed. Page-level XSS in Gmail cannot inject a signature; it can only present a draft to the user that they must confirm via biometric.



---

## 4. Module Contracts

### 4.1 `@proofline/crypto`

```typescript
export interface CryptoProvider {
  sign(privateKey: KeyHandle, message: Uint8Array): Promise<Signature>;
  verify(publicKey: PublicKey, message: Uint8Array, sig: Signature): Promise<boolean>;
  hash(input: Uint8Array): Uint8Array;
  randomBytes(length: number): Uint8Array;
}

export type Signature = string;       // base64url DER
export type PublicKey = string;       // SPKI base64
export type KeyHandle =
  | { kind: "kms"; resourceName: string }
  | { kind: "webauthn"; credentialId: string };
```

**No other package imports the underlying crypto library directly.**

### 4.2 `@proofline/canonical`

```typescript
export function canonicalize(value: unknown): Uint8Array;
// RFC 8785 — deterministic, lexicographic key ordering, no whitespace
```

Any change here breaks every existing signature — golden-vector tests prevent drift.

### 4.3 `@proofline/verification`

```typescript
export interface RegistryView {
  getCompany(companyId: string): Promise<Company | null>;
  getUserCredential(credId: string): Promise<RoleCredential | null>;
  isRevoked(credId: string): Promise<boolean>;
  isNonceUsed(nonce: string): Promise<boolean>;
  recordNonce(nonce: string, ttlSeconds: number): Promise<void>;
  getLatestAnchor(): Promise<Anchor | null>;
}

export type VerificationResult =
  | { ok: true; payload: WirePayload | BilateralPayload; signers: SignerInfo[] }
  | { ok: false; code: VerificationFailureCode; detail: string };

export function verifyEnvelope(
  env: SignedEnvelope,
  view: RegistryView,
  now?: () => number,
): Promise<VerificationResult>;
```

### 4.4 `@proofline/bilateral`

```typescript
export type BilateralStatus =
  | "DRAFT" | "PENDING_COUNTERPARTY"
  | "BILATERAL_SIGNED" | "EXPIRED" | "REVOKED";

export interface BilateralProvider {
  draftDocument(input: DraftInput): Promise<BilateralPayload>;
  signAsDrafter(docId: string, assertion: WebAuthnAssertion): Promise<SignedEnvelope>;
  signAsCounterparty(docId: string, assertion: WebAuthnAssertion): Promise<SignedEnvelope>;
  revoke(docId: string, by: ActorRef): Promise<void>;
  getStatus(docId: string): Promise<BilateralStatus>;
}
```

### 4.5 `@proofline/anchoring`

```typescript
export interface AnchorProvider {
  buildTree(events: RegistryEvent[]): MerkleTree;
  postAnchor(root: Hex32): Promise<AnchorReceipt>;
  readAnchor(root: Hex32): Promise<{ blockNumber: number; timestamp: number } | null>;
  verifyProof(leaf: Hex32, proof: MerkleProof, root: Hex32): boolean;
}
```

Implementation uses **viem** for Base Sepolia. Contract documented in §6.

### 4.6 `@proofline/kyb`

```typescript
export interface KYBProvider {
  verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification>;
  verifyOfficer(input: OfficerKYCInput): Promise<OfficerVerification>;
}

export type BusinessLookupInput = {
  legalName: string;
  ein: string;                    // optional once name+address lookup lands
  state: string;
  country: "US";
  // planned (PFL-161): city / address — Baselayer needs
  // city + state at minimum
};

export type KYBFlag = {
  type: string;                   // e.g. sanctions_hit, tin_mismatch, tin_pending
  severity: "low" | "medium" | "high";
  detail?: string;
};

export type BusinessVerification = {
  ok: boolean;
  vendorRef: string;              // vendor business / search ID
  flags: KYBFlag[];               // sanctions hit, name mismatch, etc
  officers: { name: string; role: string }[];
  raw: unknown;                   // full vendor response, for audit
};

export type OfficerKYCInput = {
  email: string;
  expectedName?: string;          // from KYB officers list
};

export type OfficerVerification = {
  ok: boolean;
  vendorRef: string;              // Stripe verification session ID
  documentVerified: boolean;
  livenessConfirmed: boolean;
  matchedExpected: boolean;
  raw: unknown;
};
```

Business KYB and officer IDV are two separate providers; each throws `WRONG_PROVIDER` on the other's method. There is no composite provider — the functions edge injects one KYB provider and one IDV provider, each selected by env (§7.0).

Implementations:
- `@proofline/kyb/providers/baselayer.ts` — Baselayer for `verifyBusiness` (primary; planned, PFL-161 — see §7.1)
- `@proofline/kyb/providers/cobalt.ts` — Cobalt Intelligence for `verifyBusiness` (fallback; planned, PFL-165)
- `@proofline/kyb/providers/stripe-identity.ts` — Stripe Identity for `verifyOfficer` (exists; not wired at the edge)
- `@proofline/kyb/providers/stub.ts` — Deterministic; used by tests and, today, by the functions edge

Status: adapter-ready, running on stub pending vendor access; stub-verified companies require manual review. The legacy `providers/middesk.ts` adapter was never wired and is removed by PFL-163.

### 4.7 `@proofline/email` — NEW DETAIL

```typescript
export interface EmailProvider {
  send(input: SendInput): Promise<{ id: string }>;
  sendVerificationCode(to: string, code: string): Promise<void>;
  sendCosignRequest(to: string[], wire: WireSummary, signLink: string): Promise<void>;
  sendInvitation(to: string, inviterCompany: string, inviteToken: string): Promise<void>;
  sendBilateralRequest(to: string, doc: BilateralSummary, signLink: string): Promise<void>;
}

type SendInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  tags?: Record<string, string>;   // for analytics
  replyTo?: string;
};
```

Implementations:
- `@proofline/email/providers/resend.ts` — Resend
- `@proofline/email/providers/stub.ts` — Captures sends in memory for tests

Status: the Resend adapter exists but is not yet wired into `apps/functions`; cosign links, onboarding codes and bilateral notifications are currently logged or stubbed. Wiring via `EMAIL_PROVIDER` is PFL-160 (§7.0, §17).

### 4.8 `@proofline/observability` — NEW DETAIL

```typescript
export interface ObservabilityProvider {
  captureError(err: Error, context?: ErrorContext): void;
  captureMessage(msg: string, level: "info" | "warning" | "error"): void;
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
  traceSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
  setUser(user: { id: string; companyId: string } | null): void;
}

type ErrorContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
};
```

PII sanitizer runs before any data is sent to Sentry — strips email addresses, account numbers, signatures, raw payloads.

### 4.9 `@proofline/invitations`

```typescript
export interface InvitationProvider {
  send(input: { inviterCompanyId: string; emails: string[]; sponsoredBy?: string }): Promise<Invitation[]>;
  accept(invitationId: string, acceptingCompanyId: string): Promise<void>;
  list(filter: { companyId: string; direction: "sent" | "received" }): Promise<Invitation[]>;
  expire(): Promise<void>;
}
```

Status: not built. `packages/invitations` is empty and `/v1/invitations` is not mounted; the admin UI falls back to fixtures (PFL-026 / PFL-132). Employee invitations (`employee_invitations`, PFL-068) are a separate, built flow.

### 4.10 `@proofline/sessions` — NEW

```typescript
export interface SessionService {
  // Open a new session via fresh WebAuthn ceremony.
  // Returns the session record + a JWS token for the
  // extension to hold.
  open(input: {
    userId: string;
    companyId: string;
    recipientAddresses: string[];   // To: addresses
    webauthnAssertion: WebAuthnAssertion;
    canonicalPayloadHash: string;   // first email being signed
  }): Promise<Result<{ session: SigningSession; token: string }, SessionError>>;

  // Validate a token + recipient set, return session if active.
  validate(input: {
    token: string;
    recipientSetHash: string;
  }): Promise<Result<SigningSession, SessionError>>;

  // Extend the sliding window after a successful silent sign.
  extend(sessionId: string): Promise<Result<SigningSession, SessionError>>;

  // Revoke a session.
  revoke(input: {
    sessionId: string;
    revokedBy: string;
    reason: SessionRevokeReason;
  }): Promise<Result<void, SessionError>>;

  // List active sessions for a user (admin view).
  listActive(input: {
    companyId: string;
    userId?: string;
  }): Promise<SigningSession[]>;
}

export type SessionRevokeReason =
  | "admin_manual"
  | "device_revoked"
  | "role_changed"
  | "user_deactivated"
  | "anomaly_detected"
  | "hard_cap_reached"
  | "logout"
  | "session_replaced";

export type SessionError =
  | { code: "SESSION_NOT_FOUND" }
  | { code: "SESSION_EXPIRED" }
  | { code: "SESSION_REVOKED"; reason: SessionRevokeReason }
  | { code: "SESSION_SCOPE_MISMATCH" }
  | { code: "TOKEN_INVALID_SIG" }
  | { code: "TOKEN_EXPIRED" };

// Helper for recipient set hashing — keys group emails consistently
export function recipientSetHash(toAddresses: string[]): string {
  const normalized = toAddresses
    .map(a => a.trim().toLowerCase())
    .sort();
  return sha256(JSON.stringify(normalized));
}
```

### 4.11 `@proofline/extension` — NEW

This package contains the Chrome extension itself. Not a library — a deliverable artifact.

**Top-level structure:**

```
apps/extension-chrome/
├── manifest.json         (Manifest v3)
├── src/
│   ├── content/          (runs in Gmail page context, isolated world)
│   │   ├── gmail-detector.ts    — detects compose/reply DOMs
│   │   ├── inject-toolbar.ts    — adds Sign button
│   │   ├── inject-badge.ts      — renders inbound verification badge
│   │   ├── extract-payload.ts   — pulls subject/body/recipients
│   │   └── inject-banner.ts     — adds outbound HTML banner
│   ├── background/       (service worker)
│   │   ├── api-client.ts        — calls proofline.app/api/*
│   │   ├── session-store.ts     — chrome.storage.local manager
│   │   ├── popup-manager.ts     — opens/closes ceremony popups
│   │   └── auth-token.ts        — extension auth token lifecycle
│   ├── popup/            (extension action popup, status display)
│   │   └── status.tsx
│   └── shared/           (types, constants)
└── tests/
    ├── content.test.ts
    └── background.test.ts
```

**Key contracts:**

```typescript
// Content script messages background to do anything that
// touches network or storage
type ContentToBackgroundMessage =
  | { type: "SIGN_EMAIL"; payload: CanonicalEmailPayload }
  | { type: "GET_SESSION_STATUS"; recipientSetHash: string }
  | { type: "VERIFY_INBOUND"; envelope: SignedEnvelope }
  | { type: "GET_AUTH_STATUS" };

type BackgroundToContentMessage =
  | { type: "SIGN_RESULT"; envelope: SignedEnvelope; banner: string }
  | { type: "SESSION_STATUS"; status: "active" | "expired" | "absent" }
  | { type: "VERIFY_RESULT"; result: VerificationResult }
  | { type: "AUTH_STATUS"; authenticated: boolean };

// Background service worker invariants:
//   - Never store secrets in localStorage (use chrome.storage.local)
//   - Never trust DOM from content script for auth state
//   - Always validate session token + auth token server-side
//   - Popup ceremonies happen via chrome.windows.create()
//     with explicit user gesture
```

**Manifest v3 considerations:**

```json
{
  "manifest_version": 3,
  "name": "ProofLine",
  "version": "1.0.0",
  "permissions": [
    "storage",
    "scripting",
    "activeTab"
  ],
  "host_permissions": [
    "https://mail.google.com/*",
    "https://app.proofline.web.app/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://mail.google.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

Service worker lifecycle: Manifest v3 service workers are non-persistent. State must be persisted in `chrome.storage` between invocations. Use `chrome.alarms` for periodic tasks (token refresh, session expiry warnings). Don't rely on top-level `setInterval`.

---



## 5. Sequence Diagrams

### 5.1 Onboarding (full integration path)

```
Owner    Web Admin     Functions    Baselayer  Stripe ID    KMS    Chain    Resend
 │           │            │            │           │           │      │         │
 │─signup───▶│            │            │           │           │      │         │
 │           │─/onboard──▶│            │           │           │      │         │
 │           │            │─create company doc                                   │
 │           │◀─dnsToken──│                                                      │
 │◀─show TXT─│            │            │           │           │      │         │
 │                                                                              │
 │ (DNS propagation, then verify)                                               │
 │           │─/verify-dns▶│                                                    │
 │           │            │─resolve TXT (3 resolvers)                           │
 │                                                                              │
 │           │             │            │           │           │       │       │
 │           │─/verify-email────────────────────────────────────────────────▶ Resend
 │           │             │                                            ◀─────  sends codes
 │ (codes typed back)                                                           │
 │           │─/verify-email-code▶│                                             │
 │                                                                              │
 │           │─/kyb──────▶│                                                     │
 │           │             │─verifyBusiness─▶│                                  │
 │           │             │                 │ POST /searches                   │
 │           │             │                 │ (Prefer: wait=N) runs:           │
 │           │             │                 │ - Sec of State registrations     │
 │           │             │                 │ - IRS TIN match                  │
 │           │             │                 │ - officers                       │
 │           │             │                 │ - OFAC / PEP watchlist           │
 │           │             │◀─verification───│                                  │
 │           │             │ store kybResult │                                  │
 │           │             │ (+ provider)    │                                  │
 │           │             │                 │                                  │
 │           │             │ if tin_pending: │                                  │
 │           │             │◀─webhook────────│ BusinessSearch.updated           │
 │           │             │ update kybResult│                                  │
 │                                                                              │
 │           │─/kyc──────▶│                                                     │
 │           │             │─verifyOfficer─────────────▶│                       │
 │ (Stripe Identity flow opens; user uploads ID, takes selfie)                  │
 │           │             │◀──verification result─────│                       │
 │                                                                              │
 │           │─/finalize─▶│                                                     │
 │           │             │─create root key─────────────────────▶│             │
 │           │             │◀────pubkey + KMS handle─────────────│             │
 │           │             │─sign role cred (root → owner)──────▶│             │
 │           │             │◀────signature───────────────────────│             │
 │           │             │─update company status=verified                     │
 │           │             │─build merkle root over registry                    │
 │           │             │─postAnchor(root)──────────────────────▶ Base       │
 │           │             │◀──tx hash + block number─────────────│            │
 │           │             │─store anchor record                                │
 │           │◀─verified───│                                                    │
 │◀─welcome──│             │                                                    │
```

Notes on the current implementation:
- The KYB column is the KYB provider slot: Baselayer (primary) or Cobalt Intelligence (fallback), selected by `KYB_PROVIDER` (§7.0). Today the edge runs the stub provider. The officer step uses the IDV slot (`IDV_PROVIDER`, Stripe Identity), also on stub today.
- In production, a company whose KYB or IDV result came from the stub is set to `onboardingStatus = pending_review` and placed in the platform review queue (PFL-142) instead of `verified`. It is never auto-approved.
- `/finalize` must enforce ownership and every prior-step gate. The `demoMode` bypass that exists today is removed by PFL-167.
- Email codes go through the `EmailProvider` once PFL-160 lands; today they are logged.
- All `/v1/onboard/*` calls require a Firebase ID token; the owner is the token UID, never a body field (PFL-166).

### 5.2 Sign + Co-Sign

Wire over the sender's per-email limit (policy decision `COSIGN_REQUIRED`).
The sender always signs first; the approval surface is the sign app
(web-sign), because approvers' passkeys are registered for
`proofline-sign.web.app` and browsers will not use them on another site.

```
Sarah (Gmail +   web-sign       Functions             Firestore        Resend     Bob (approver)
extension)       popup                                                             on web-sign
  │─Sign──────────▶│                                                                   │
  │                │─POST /v1/sign─▶ policy: COSIGN_REQUIRED                           │
  │                │                 approvers = active owners/managers                │
  │                │                 of the company, excluding Sarah                   │
  │                │◀─challenge + approvers (none → 422 NO_ELIGIBLE_COSIGNER)          │
  │                │ Sarah: fresh biometric                                            │
  │                │─POST /v1/sign/finalize▶ verify Sarah's assertion                  │
  │                │                 envelope status PENDING_COSIGN ─▶│                │
  │                │                 cosign.approverEmails            │                │
  │                │                 mint HS256 link JWS (exp = cosignTtlMs)           │
  │                │                 sendCosignRequest(approvers) ──────────▶│         │
  │                │◀─{cosign: PENDING_COSIGN}                               │─email──▶│
  │◀─COSIGN_PENDING (send stays blocked, no "send unsigned")                           │
  │                                                                                    │
  │                                  GET /v1/cosign/:id?token  ◀───── /cosign/:id?t= ──│
  │                                  verify JWS signature, payloadHash, company        │
  │                                  status must be PENDING_COSIGN                     │
  │                                  ───── envelope + payload + challenge ───────────▶│
  │                                                     F-SIG-09 checks: recompute    │
  │                                                     hash, link ↔ message, expiry, │
  │                                                     company; show exact wire      │
  │                                                     Bob: fresh biometric          │
  │                                  POST /v1/cosign/:id/finalize ◀───────────────────│
  │                                  verify Bob's assertion (RP proofline-sign.web.app)│
  │                                  Bob: active owner/manager, same company, not the  │
  │                                  sender, device not revoked, on approver list      │
  │                                  append second signature, status COSIGNED,         │
  │                                  queue anchor ────────────────▶│                   │
  │                                                                                    │
  │─GET /v1/sign/status/:id ─▶ COSIGNED  (extension release: follow-up)                │
```

Refresh (`POST /v1/cosign/:id/refresh`) re-mints the link for a correctly
signed token up to 7 days past expiry, emails only the stored approvers and
is capped at 5 per hour per message.

### 5.3 Async Bilateral

```
Acme     Functions    Firestore    Resend    Scotia AP
  │          │             │           │           │
  │─/draft──▶│             │           │           │
  │          │─create doc─▶│                       │
  │◀─docId───│                                     │
  │                                                │
  │─/sign-as-drafter (assertion)─▶│               │
  │          │ verify role + sig                  │
  │          │ status=PENDING_COUNTERPARTY        │
  │          │─sendBilateralRequest─▶│            │
  │          │                       │─email──────▶
  │                                                │
  │  (overnight pause)                             │
  │                                                │
  │                                  │ Scotia opens│
  │                                  │ click link  │
  │                                  │ biometric   │
  │                                  │             │
  │          │◀─/sign-as-counterparty (assertion)─│
  │          │ verify same canonical bytes        │
  │          │ status=BILATERAL_SIGNED            │
  │          │ trigger anchor batch               │
```

### 5.4 Public Verification

```
Browser     Verify API    Firestore    Chain RPC
  │             │             │            │
  │─GET /v1/verify/{id}─────▶│            │
  │             │ build RegistryView       │
  │             │─load envelope─▶│         │
  │             │─load company─▶│          │
  │             │─load anchor──▶│          │
  │             │                          │
  │             │─readAnchor(root)─────────▶
  │             │◀─block + timestamp───────│
  │             │                          │
  │             │ run verifyEnvelope():    │
  │             │  1. payload integrity    │
  │             │  2. company known        │
  │             │  3. anchor consistency   │
  │             │  4. signatures           │
  │             │  5. policy               │
  │             │  6. freshness            │
  │             │  7. bilateral check      │
  │             │                          │
  │◀─render(state, payload, signers)──────│
```

### 5.5 Session Establishment (first email to a recipient)

```
Sarah    Gmail Compose    Extension    Popup        proofline.app    Firestore   Resend
  │           │              │           │                │              │          │
  │ types email + clicks Send             │                │              │          │
  │──────────▶│              │           │                │              │          │
  │           │ DOM event ──▶│           │                │              │          │
  │           │              │ extract canonical payload  │              │          │
  │           │              │ recipientSetHash = sha256(sortedSet(toAddrs))         │
  │           │              │ check chrome.storage.local │              │          │
  │           │              │ → no active session for this recipient   │          │
  │           │              │           │                │              │          │
  │           │              │─chrome.windows.create(popup)              │          │
  │           │              │           │ navigates to proofline.app/sign/start    │
  │           │              │           │     ?recipient=mark@...&hash=<payloadHash>│
  │           │              │           │                │              │          │
  │           │              │           │ shows: "Start signing session with Mark? │
  │           │              │           │         [payload preview]                 │
  │           │              │           │         [Sign with Touch ID]"             │
  │           │              │           │                │              │          │
  │ sees popup, taps Touch ID │           │                │              │          │
  │──────────────────────────────────────▶│                │              │          │
  │           │              │           │ navigator.credentials.get()              │
  │           │              │           │ userVerification: "required"             │
  │           │              │           │ challenge = sha256(canonical)            │
  │           │              │           │                │              │          │
  │           │              │           │ OS biometric prompt → Touch ID confirms  │
  │           │              │           │ Secure Enclave returns ECDSA assertion   │
  │           │              │           │                │              │          │
  │           │              │           │─POST /api/sessions/open──────▶│          │
  │           │              │           │                │ validatePolicy() FULL    │
  │           │              │           │                │ verify assertion         │
  │           │              │           │                │ create session record    │
  │           │              │           │                │─write─▶│                 │
  │           │              │           │                │        │                 │
  │           │              │           │                │ record signed envelope   │
  │           │              │           │                │ for THIS first email     │
  │           │              │           │                │ render banner HTML       │
  │           │              │           │                │ queue Merkle batch       │
  │           │              │           │                │              │          │
  │           │              │           │◀─{token, banner, envelopeId}─│          │
  │           │              │           │                │              │          │
  │           │              │◀─postMessage(token, banner)│              │          │
  │           │              │ store token in chrome.storage.local       │          │
  │           │              │ inject banner HTML at top of email body  │          │
  │           │              │           │ popup.close()                 │          │
  │           │              │           │                │              │          │
  │           │ Gmail send proceeds normally              │              │          │
  │           │              │           │                │              │─send─────▶
  │           │              │           │                │              │          │
  │ sees "sent" confirmation, popup closed                │              │          │
  │           │              │           │                │              │          │
  │ total time: ~2 seconds end to end                                              │
```

### 5.6 Silent In-Session Signing (subsequent emails to same recipient)

```
Sarah    Gmail Compose    Extension    Hidden Popup    proofline.app    Firestore
  │           │              │              │                │              │
  │ types reply to Mark + clicks Send (within 15 min)        │              │
  │──────────▶│              │              │                │              │
  │           │ DOM event ──▶│              │                │              │
  │           │              │ extract payload                              │
  │           │              │ recipientSetHash matches active session     │
  │           │              │              │                │              │
  │           │              │─POST /api/sign-silent───────▶│              │
  │           │              │  Authorization: Bearer <sessionToken>       │
  │           │              │  + payload                   │              │
  │           │              │              │                │              │
  │           │              │              │ validateSessionToken(token)  │
  │           │              │              │ FETCH session record          │
  │           │              │              │ check active/exp/scope        │
  │           │              │              │ validatePolicy() FULL pipeline│
  │           │              │              │ → returns webauthn challenge  │
  │           │              │              │                │              │
  │           │              │◀──{challenge}───────────────│              │
  │           │              │              │                │              │
  │           │              │─chrome.windows.create({state: "minimized"}) │
  │           │              │              │ proofline.app/sign/silent     │
  │           │              │              │ navigator.credentials.get()   │
  │           │              │              │ userVerification: "discouraged"│
  │           │              │              │                │              │
  │           │              │              │ OS treats recent UV as valid;│
  │           │              │              │ no biometric prompt           │
  │           │              │              │ Secure Enclave returns assertion│
  │           │              │              │                │              │
  │           │              │◀─postMessage(assertion)──────│              │
  │           │              │ popup auto-closes            │              │
  │           │              │              │                │              │
  │           │              │─POST /api/sign-silent/finalize──────────────▶
  │           │              │              │                │ verify assertion│
  │           │              │              │                │ run policy AGAIN│
  │           │              │              │                │ record envelope │
  │           │              │              │                │ extend session  │
  │           │              │              │                │   expiresAt += 15min│
  │           │              │              │                │ queue Merkle    │
  │           │              │              │                │              │
  │           │              │◀──{envelope, banner}─────────│              │
  │           │              │ inject banner at top of email body          │
  │           │              │              │                │              │
  │           │ Gmail send proceeds                          │              │
  │           │              │              │                │              │
  │ from Sarah's POV: clicked Send, brief tab flicker, email sent
  │ no biometric prompt — under 1 second
```

### 5.7 Session Revocation (admin or system)

```
Admin       Web Admin App    Functions    Firestore   Active Sessions    Extension
  │              │               │            │              │              │
  │ admin opens "Active sessions" view        │              │              │
  │─────────────▶│               │            │              │              │
  │              │─GET /sessions/active─────▶│              │              │
  │              │               │ fetch ────▶│              │              │
  │              │◀──[sessions]──│            │              │              │
  │              │               │            │              │              │
  │ sees Sarah has 3 active sessions          │              │              │
  │ clicks "Revoke" on one                    │              │              │
  │─────────────▶│               │            │              │              │
  │              │ require fresh WebAuthn for sensitive admin action       │
  │              │ admin Touch-IDs                          │              │
  │              │               │            │              │              │
  │              │─POST /sessions/{id}/revoke──────────────▶│              │
  │              │               │            │ update status="revoked"   │
  │              │               │            │ revokedBy=admin, reason="admin_manual"│
  │              │               │            │ ─────────▶│                  │
  │              │               │            │           │                  │
  │              │               │            │ emit audit event             │
  │              │◀──{ok}────────│            │              │              │
  │              │               │            │              │              │
  │ Sarah composes another email to that recipient          │              │
  │              │               │            │              │ ◀── SIGN req │
  │              │               │            │              │              │
  │              │               │ validateSessionToken passes (JWS valid) │
  │              │               │ but session.status === "revoked"        │
  │              │               │ returns SESSION_REVOKED                 │
  │              │               │            │              │              │
  │              │               │            │              │ → Extension clears
  │              │               │            │              │   stored session
  │              │               │            │              │   token, opens
  │              │               │            │              │   fresh-auth popup
  │              │               │            │              │   on next compose
```

---



## 6. On-Chain Anchor Contract

### 6.1 Contract

```solidity
// contracts/src/Anchor.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProofLineAnchor {
    event RootAnchored(
        bytes32 indexed root,
        uint256 indexed sequence,
        address indexed anchorer,
        uint256 timestamp
    );

    mapping(bytes32 => uint256) public rootToBlock;
    uint256 public latestSequence;
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    function anchorRoot(bytes32 root) external {
        require(msg.sender == owner, "unauthorized");
        require(rootToBlock[root] == 0, "already anchored");
        latestSequence += 1;
        rootToBlock[root] = block.number;
        emit RootAnchored(root, latestSequence, msg.sender, block.timestamp);
    }

    function isAnchored(bytes32 root) external view returns (bool) {
        return rootToBlock[root] != 0;
    }
}
```

### 6.2 Tests + Deploy + Client

(Foundry tests, deploy script, and viem TypeScript client identical to TDD v2.0 §6.2–§6.4 — see prior version.)

### 6.3 Anchoring Operations

- Anchoring is real on Base Sepolia (PFL-114); a scheduled function (`anchorBatchScheduler`) batches registry events into a Merkle root and posts it. Base mainnet is deferred (Phase 10).
- Provider is explicit: `ANCHOR_PROVIDER=base-sepolia|stub`. `stub` is refused when `PROOFLINE_ENV=production`; the verify router never falls back to a stub chain reader (§17).
- If the chain or RPC is unavailable, events remain unanchored until the next successful batch. No cached or fabricated receipt is ever substituted.
- The manual trigger `POST /v1/admin/anchor/run` (`anchorAdmin`) currently has no auth. It is locked to platform-admin Firebase auth or removed (PFL-170).

---

## 7. External Integrations — Implementation Detail

### 7.0 Provider Selection

Every external integration sits behind a package interface (§4) and is chosen at the functions edge from environment configuration. Selection happens once per cold start in the config module (§17.1), is logged, and never changes silently at runtime.

```
  Slot        Env var          Values                     Today (main)
  ─────────   ──────────────   ────────────────────────   ─────────────────
  KYB         KYB_PROVIDER     stub | baselayer | cobalt  stub (hard-coded)
  IDV         IDV_PROVIDER     stub | stripe              stub (hard-coded)
  Email       EMAIL_PROVIDER   resend | stub              stub (not wired)
  Anchoring   ANCHOR_PROVIDER  base-sepolia | stub        base-sepolia
  KMS         KMS_PROVIDER     gcp | stub                 gcp when env set
```

Rules (full table with defaults and secrets in §17.3):
- Adding vendor keys and flipping the env var makes a provider live — no code change.
- A stub in use is logged at startup (`[config] KYB_PROVIDER=stub`). There is never a silent fallback from a real provider to a stub.
- A real provider configured without its key is a startup error.
- Every stored verification result records the provider name (`kybResult.provider`, `kycResult.provider`) so stub results can be identified and routed to manual review later.

Today `makeStubOnboardingDeps()` in `apps/functions/src/wiring/stubs.ts` hard-codes the KYB, IDV, email-code and onboarding-anchor providers; only KMS is env-selected (`resolveKmsConfigFromEnv`). PFL-162 adds `resolveKybConfigFromEnv` / IDV selection next to it; PFL-169 moves all slots into the config module.

### 7.1 Business KYB — Baselayer (primary), Cobalt Intelligence (fallback)

**Status:** adapter-ready, running on stub pending vendor access; stub-verified companies require manual review.

Middesk was dropped because its sandbox is sales-gated. Baselayer is primary because it offers a self-serve free sandbox and returns Secretary of State, IRS TIN match, officers and OFAC/PEP screening from one call. Cobalt Intelligence is the fallback (self-serve free account on live data).

#### 7.1.1 Baselayer API shape

- `POST /searches` with `name`, `address` (city + state minimum), optional `tin`, optional officers and website.
- Header `Prefer: wait=N` holds the request until the search completes or N seconds elapse, so it fits the existing synchronous `kyb.handler.ts` call.
- Response fields used: `registrations[]` (SoS), `tin_matched` (IRS; `null` while the IRS is unavailable), `business_officers[]`, `watchlist_hits[]` (OFAC / PEP), `warnings[]`, `verified`, `state`, `id`.
- When `tin_matched` is `null`, Baselayer later sends a `BusinessSearch.updated` webhook with the final value.
- Sandbox: self-serve and free, but accepts only Baselayer's predefined test businesses (inputs must match exactly). Production pricing starts at $150/month.

Mapping to `BusinessVerification` (§4.6):

| Field | Source |
|---|---|
| `ok` | `verified && tin_matched !== false && watchlist_hits.length === 0` |
| `vendorRef` | search `id` |
| `flags` | `warnings` + mismatches (`tin_mismatch`) + watchlist codes (`sanctions_hit`) + `tin_pending` / `search_pending` |
| `officers` | `business_officers` → `{ name, role }` |
| `raw` | full search response, for audit |

#### 7.1.2 Adapter sketch

Against the existing `KYBProvider` interface in `packages/kyb/src/types.ts`. Not yet implemented (PFL-161); field names must be confirmed against the sandbox response.

```typescript
// packages/kyb/src/providers/baselayer.ts
import type { KYBProvider, BusinessLookupInput, BusinessVerification, KYBFlag } from "../types.js";

export interface BaselayerConfig {
  apiKey: string;
  baseUrl?: string;          // sandbox vs prod host per Baselayer docs
  waitSeconds?: number;      // Prefer: wait=N (default 25, under the Functions timeout)
  fetch?: typeof globalThis.fetch;
}

export function makeBaselayerProvider(cfg: BaselayerConfig): KYBProvider {
  const f = cfg.fetch ?? globalThis.fetch;
  return {
    async verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification> {
      const res = await f(`${cfg.baseUrl}/searches`, {
        method: "POST",
        headers: {
          "X-API-Key": cfg.apiKey,
          "Content-Type": "application/json",
          Prefer: `wait=${cfg.waitSeconds ?? 25}`,
        },
        body: JSON.stringify({
          name: input.legalName,
          tin: input.ein?.replace(/\D/g, ""),
          address: { state: input.state },        // Baselayer wants city+state minimum: extend BusinessLookupInput
        }),
      });
      if (!res.ok) throw new Error(`BASELAYER_HTTP_${res.status}`);
      const s = await res.json();

      const flags: KYBFlag[] = [
        ...(s.warnings ?? []).map((w: any) => ({ type: `warning:${w.code ?? w}`, severity: "medium" as const, detail: w.message })),
        ...(s.watchlist_hits ?? []).map((h: any) => ({ type: "sanctions_hit", severity: "high" as const, detail: h.list ?? h.source })),
        ...(s.tin_matched === false ? [{ type: "tin_mismatch", severity: "high" as const }] : []),
        ...(s.tin_matched == null ? [{ type: "tin_pending", severity: "low" as const, detail: "IRS unavailable; awaiting BusinessSearch.updated" }] : []),
        ...(s.state !== "COMPLETED" ? [{ type: "search_pending", severity: "low" as const }] : []),
      ];

      return {
        ok: Boolean(s.verified) && s.tin_matched !== false && !(s.watchlist_hits?.length),
        vendorRef: s.id,
        flags,
        officers: (s.business_officers ?? []).map((o: any) => ({ name: o.name, role: o.titles?.[0] ?? o.title ?? "officer" })),
        raw: s,
      };
    },
    async verifyOfficer() {
      throw new Error("WRONG_PROVIDER: use Stripe Identity for verifyOfficer");
    },
  };
}
```

#### 7.1.3 Async completion (`tin_pending` / `search_pending`)

```
kyb.handler ──verifyBusiness──▶ Baselayer (Prefer: wait=25)
     │◀── result (tin_matched=null → flag tin_pending)
     │ store companies/{id}.kybResult
     │   { provider, vendorRef, ok, flags, status: "pending" }
     │ onboarding continues; finalize gate waits on kybResult
     │
     ⋮  (IRS back online)
     │
POST /v1/webhooks/kyb/baselayer ◀── BusinessSearch.updated
     │ verify webhook signature (BASELAYER_WEBHOOK_SECRET)
     │ look up company by vendorRef
     │ re-map search → BusinessVerification
     │ update kybResult { ok, flags, status: "complete" }
     │ tin_mismatch / watchlist hit → pending_review (PFL-142)
```

Edge changes (PFL-162): add `resolveKybConfigFromEnv` (`KYB_PROVIDER`, `BASELAYER_API_KEY`) beside `resolveKmsConfigFromEnv`; add the webhook route; extend `BusinessLookupInput` with optional `city` / `address`. The Functions timeout for the KYB route must exceed `waitSeconds`.

#### 7.1.4 Cobalt Intelligence fallback (`KYB_PROVIDER=cobalt`)

- Self-serve free account on live data. Planned adapter: `packages/kyb/src/providers/cobalt.ts` (PFL-165).
- `verifyBusiness()` fans out to three calls: SoS search (status, officers, registered agent), a separate TIN verification call, and a separate OFAC call. Results are merged into one `BusinessVerification` with the same flag vocabulary as Baselayer.
- The SoS search can take 15–30 s or return a `retryId` that must be polled. The function serving the KYB route needs a timeout of at least 120 s.
- Also usable as an inexpensive SoS cross-check.

#### 7.1.5 Stub behaviour and manual review

- `providers/stub.ts` returns a deterministic `ok: true` result. It exists for tests and for environments without vendor access.
- When the stub is selected, startup logs it explicitly. The stored `kybResult.provider` is `"stub"`.
- In `PROOFLINE_ENV=production`, any company whose KYB (or IDV) result came from the stub is set to `onboardingStatus = pending_review` and placed in the platform review queue (PFL-142). It is never auto-approved. A reviewer approves or rejects; the decision is audited.
- Real-provider results with `ok=false` or any flag of severity `medium` or higher also route to the review queue.
- The "skip" buttons in the onboarding wizard that wrote `vendorRef: 'demo-skipped'` are removed (PFL-168); dev data comes from a dev-only seed script.

### 7.2 Officer IDV — Stripe Identity (`IDV_PROVIDER=stripe`)

**Status:** adapter-ready, running on stub pending vendor access; stub-verified companies require manual review. The adapter in `packages/kyb/src/providers/stripe-identity.ts` exists (PFL-013); the edge injects `stubStripeIdentityProvider` until `IDV_PROVIDER` selection lands (PFL-162 / PFL-176). Setting `IDV_PROVIDER=stripe` requires `STRIPE_SECRET_KEY` and `STRIPE_IDENTITY_WEBHOOK_SECRET`; a missing key is a startup error. The current onboarding KYC step calls `verifyOfficer` synchronously; the production flow is session + webhook as below. The web-admin KYC step must fail closed when no Stripe publishable key is configured (no simulated success).

Simplified sketch (the shipped adapter follows the same shape):

```typescript
// packages/kyb/src/providers/stripe-identity.ts
import Stripe from "stripe";

export function makeStripeIdentityProvider(config: { secretKey: string }): KYBProvider {
  const stripe = new Stripe(config.secretKey, { apiVersion: "2024-06-20" });

  return {
    verifyBusiness: async () => { throw new Error("WRONG_PROVIDER: use a KYB business provider"); },
    async verifyOfficer(input) {
      const session = await stripe.identity.verificationSessions.create({
        type: "document",
        metadata: { email: input.email },
        options: {
          document: {
            require_id_number: false,
            require_live_capture: true,
            require_matching_selfie: true,
          },
        },
      });
      // Returns clientSecret to embed in browser; await webhook for result
      return {
        ok: false,                  // pending
        vendorRef: session.id,
        documentVerified: false,
        livenessConfirmed: false,
        matchedExpected: false,
        raw: { clientSecret: session.client_secret, sessionId: session.id },
      };
    },
  };
}
```

The browser embeds Stripe Identity using the `client_secret`. Webhook (`identity.verification_session.verified`) triggers a Firestore update marking the officer verified.

### 7.3 Resend

```typescript
// packages/email/src/providers/resend.ts
import { Resend } from "resend";

export function makeResendProvider(config: { apiKey: string; fromDomain: string }): EmailProvider {
  const resend = new Resend(config.apiKey);
  const from = `ProofLine <noreply@${config.fromDomain}>`;

  return {
    async send({ to, subject, html, text, tags, replyTo }) {
      const { data, error } = await resend.emails.send({
        from, to, subject, html, text, replyTo, tags: toTagArray(tags),
      });
      if (error) throw new Error(`Resend failed: ${error.message}`);
      return { id: data!.id };
    },
    async sendVerificationCode(to, code) {
      await this.send({
        to: [to],
        subject: "Your ProofLine verification code",
        html: render("verification-code", { code }),
        text: `Your code: ${code}`,
        tags: { type: "verification" },
      });
    },
    async sendCosignRequest(to, wire, signLink) {
      await this.send({
        to,
        subject: `Co-sign request: ${formatUSD(wire.amount)}`,
        html: render("cosign-request", { wire, signLink }),
        text: `Co-sign needed for ${formatUSD(wire.amount)}: ${signLink}`,
        tags: { type: "cosign" },
      });
    },
    // ... sendInvitation, sendBilateralRequest similar
  };
}
```

Templates in `packages/email/templates/` as React Email components.

Status: adapter exists (PFL-014) but is not wired at the functions edge. PFL-160 selects it via `EMAIL_PROVIDER=resend` (requires `RESEND_API_KEY`, `RESEND_FROM_DOMAIN`) and injects it into the onboarding email-code step, cosign refresh and bilateral notifications. Verification codes are never logged. Link hosts in templates (invite, verify) come from config, and interpolated values are HTML-escaped.

### 7.4 Sentry

```typescript
// packages/observability/src/providers/sentry.ts
import * as Sentry from "@sentry/node";

export function makeSentryProvider(config: { dsn: string; environment: string }): ObservabilityProvider {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    tracesSampleRate: 1.0,
    beforeSend: sanitizePII,         // strips emails, payloads, sigs
  });

  return {
    captureError(err, ctx) {
      Sentry.captureException(err, {
        tags: ctx?.tags,
        extra: ctx?.extra,
        fingerprint: ctx?.fingerprint,
      });
    },
    captureMessage(msg, level) {
      Sentry.captureMessage(msg, level as Sentry.SeverityLevel);
    },
    log(level, event, data) {
      // Pipe to Sentry breadcrumb + Cloud Logging
      Sentry.addBreadcrumb({ category: event, level, data });
      console[level === "warn" ? "warn" : "log"](JSON.stringify({ event, ...data }));
    },
    traceSpan(name, fn) {
      return Sentry.startSpan({ name }, fn);
    },
    setUser(user) {
      Sentry.setUser(user ? { id: user.id, companyId: user.companyId } : null);
    },
  };
}
```

### 7.5 Cloud KMS

```typescript
// packages/crypto/src/providers/gcp-kms.ts
import { KeyManagementServiceClient } from "@google-cloud/kms";

export function makeKMSCryptoProvider(config: {
  projectId: string;
  location: string;
  keyRing: string;
}): CryptoProvider {
  const client = new KeyManagementServiceClient();

  return {
    async sign(privateKey, message) {
      if (privateKey.kind !== "kms") throw new Error("Wrong key handle");
      const digest = sha256(message);
      const [resp] = await client.asymmetricSign({
        name: privateKey.resourceName,
        digest: { sha256: digest },
      });
      return base64urlEncode(resp.signature!);
    },
    async verify(publicKey, message, sig) {
      // KMS doesn't verify; verification uses pure-JS ECDSA
      return verifyEcdsaP256(publicKey, message, sig);
    },
    hash: (input) => sha256(input),
    randomBytes: (length) => crypto.randomBytes(length),
  };
}

export async function createCompanyRootKey(client, opts: {
  projectId: string; location: string; keyRing: string; companyId: string;
}): Promise<KeyHandle> {
  const [key] = await client.createCryptoKey({
    parent: client.keyRingPath(opts.projectId, opts.location, opts.keyRing),
    cryptoKeyId: `company-${opts.companyId}`,
    cryptoKey: {
      purpose: "ASYMMETRIC_SIGN",
      versionTemplate: { algorithm: "EC_SIGN_P256_SHA256" },
    },
  });
  return { kind: "kms", resourceName: key.name! };
}
```

Status: built — company root keys are created in Cloud KMS (PFL-126). Today the edge selects real KMS when `GOOGLE_CLOUD_PROJECT` (or `KMS_PROJECT`) and `KMS_KEYRING` are set and otherwise falls back to a stub signer; PFL-169 replaces this with explicit `KMS_PROVIDER=gcp|stub`, with `stub` refused in production. Role credentials issued at registration must be signed by the company KMS root (PFL-100.1), which removes the need to trust unsigned role credentials during verification (§17.6).

### 7.6 Gemini

Status: not built. `packages/ai` is empty; the sketch below is the target design for PFL-028 (memo screening of wire-instruction payloads in the sign pipeline).

```typescript
// packages/ai/src/providers/gemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

export function makeGeminiAIProvider(config: { apiKey: string }) {
  const client = new GoogleGenerativeAI(config.apiKey);
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

  return {
    async scoreMemo(text: string): Promise<{ score: number; flags: string[]; reason: string }> {
      const prompt = `
Analyze this wire transfer memo for social engineering / BEC scam patterns.
Return JSON only: {"score": 0.0-1.0, "flags": [...], "reason": "..."}.
Patterns: urgency, secrecy, executive impersonation, bypass procedures.
Memo: "${text}"`;
      const result = await model.generateContent(prompt);
      const json = result.response.text().match(/\{[\s\S]*\}/)?.[0];
      return JSON.parse(json ?? '{"score":0,"flags":[],"reason":"parse failed"}');
    },
  };
}
```

---

## 8. Cryptographic Specification

(Identical to v2.0 §7 — algorithms, payload schemas, role credentials, signed envelopes preserved.)

---

## 9. Verification Algorithm

(Identical to v2.0 §8 — the 7-check pipeline.)

---

## 10. Data Persistence Strategy

(Identical to v2.0 §9 — append-only, Firestore index plan preserved.)

---

## 11. Authentication & Session Management

### 11.1 Web Admin App Auth

- Firebase Auth (email magic link via Resend or Google OAuth)
- Bearer ID token in `Authorization` header
- Tenant scoping by `companyId` claim
- Sensitive admin actions (revoke device, revoke session, change policy) require additional fresh WebAuthn assertion

### 11.2 Counterparty Portal Auth

Internal cosign approval does **not** run on the counterparty portal. It runs
on the sign app at `https://proofline-sign.web.app/cosign/{messageId}?t={token}`
(§5.2), because approvers' passkeys are registered for RP ID
`proofline-sign.web.app` and `web.app` is a public suffix, so the portal is a
different site. The cosign token is an HS256 JWS (`COSIGN_REFRESH_SECRET`)
scoped to one messageId and payloadHash; the server verifies its signature
before reading any claim. The approver's identity comes from the verified
assertion's credential, never from the request.

The same RP-ID constraint applies to bilateral counterparty signing; moving
that ceremony to web-sign is tracked in PFL-182.

The rest of this section covers bilateral documents.

Counterparty receives a signed link:
```
https://counterparty.proofline.web.app/sign/{docId}?t={signedToken}
```
Token is a JWS signed by inviter's company root, scoping access to one document. Signing surface MUST follow the 6-step pre-biometric verification per ADR-0010 (re-fetch + re-verify before triggering WebAuthn ceremony).

The counterparty's identity (`userId`, `companyId`) is derived server-side from the token and the verified WebAuthn assertion — never from the request body or URL query. Today `sign-as-counterparty` and the portal still read these from the body / URL; fixed under PFL-166 / PFL-171. Link-token secrets (`BILATERAL_JWT_SECRET`, `COSIGN_REFRESH_SECRET`) are bound as Functions secrets with no hardcoded fallback (§17.4).

### 11.3 Verification Page Auth

**No authentication.** Verification is public by design.

### 11.4 Chrome Extension Auth

The extension never holds long-lived credentials in the page context.

```
┌──────────────────────────────────────────────────────────┐
│         EXTENSION AUTH FLOW                              │
└──────────────────────────────────────────────────────────┘

  FIRST INSTALL
  ─────────────
  1. User installs extension from Chrome Web Store
  2. Extension shows "Connect to ProofLine" button in
     Gmail toolbar
  3. Click → opens popup window:
       https://app.proofline.web.app/extension/auth
       ?ext_id=<extension_install_id>
  4. User completes Firebase Auth login on
     proofline.app (proper origin, full WebAuthn
     compatibility)
  5. After login, server issues an extension-bound
     auth token:
       JWS payload {
         v: 1,
         userId,
         companyId,
         extInstallId,
         iat,
         exp: iat + 30 days
       }
       signed by ProofLine root
  6. Popup posts the token back to the extension via
     postMessage
  7. Extension stores token in chrome.storage.local
  8. Popup auto-closes
  9. Extension's "Sign with ProofLine" controls become
     active in Gmail compose

  TOKEN REFRESH
  ─────────────
  Extension auth token has 30-day TTL.
  10 days before expiry, extension silently re-auths
  in background popup if user has an active Firebase
  session. Otherwise prompts on next compose.

  STORAGE ISOLATION
  ─────────────
  chrome.storage.local is isolated from Gmail's page
  JS by Chromium's extension security model. Other
  extensions cannot read it (chrome.storage is
  per-extension). Web pages cannot read it (no
  cross-context API).

  Page JS in mail.google.com cannot access:
   ─ Extension auth token
   ─ Session tokens (per-recipient)
   ─ User identity records
   ─ Extension's API endpoints (those run in service
     worker, not content script)
```

### 11.5 Per-Recipient Signing Session Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│         SESSION STATE MACHINE                            │
└──────────────────────────────────────────────────────────┘

      ┌─────────────┐
      │   ABSENT    │  No session for this recipient
      └──────┬──────┘
             │ user composes new email
             │ + biometric ceremony (visible popup)
             ▼
      ┌─────────────┐
      │   ACTIVE    │  expiresAt = now + 15min
      └──────┬──────┘
             │
       ┌─────┴─────┬──────────┬──────────┬─────────────┐
       │           │          │          │             │
       ▼           ▼          ▼          ▼             ▼
  silent send   15min      hard cap   admin        device/
  (extends      idle       (60min)    revoke       role/cparty
   sliding)     elapsed                              change
       │           │          │          │             │
       │           ▼          ▼          ▼             ▼
       │      ┌──────┐   ┌────────┐  ┌────────┐   ┌────────┐
       │      │EXPIRED│   │EXPIRED │  │REVOKED │   │REVOKED │
       │      └──┬───┘   └───┬────┘  └───┬────┘   └───┬────┘
       │         │           │           │            │
       │         └───────────┼───────────┴────────────┘
       │                     ▼
       │              ┌─────────────┐
       │              │   ABSENT    │
       │              └─────────────┘
       │
       └──▶ stays ACTIVE, expiresAt extended
```

**Storage:**
```typescript
// Firestore: sessions/{sessionId}
type SigningSession = {
  sessionId: string;            // UUIDv7
  userId: string;
  companyId: string;
  recipientSetHash: string;     // sha256(sortedSet(toAddresses))
  recipientAddresses: string[]; // for display, not auth
  authorizedAt: number;         // unix ms
  expiresAt: number;            // sliding window
  hardCapAt: number;            // authorizedAt + 60min
  deviceCredentialId: string;   // which credential authorized
  status: "active" | "expired" | "revoked";
  revokedAt?: number;
  revokedBy?: string;           // userId or "system"
  revokeReason?: string;
  lastUsedAt: number;
  signCount: number;
};
```

**Extension-held token:**
```typescript
// chrome.storage.local: session:<recipientSetHash>
type SessionToken = {
  token: string;          // JWS signed by ProofLine root
  recipientSetHash: string;
  expiresAt: number;      // matches session.expiresAt
  hardCapAt: number;
};

// JWS payload:
type SessionTokenPayload = {
  v: 1;
  sessionId: string;
  userId: string;
  companyId: string;
  recipientSetHash: string;
  iat: number;
  exp: number;
};
```

**Why both server record AND token:**

The server record is the **authority**. It enforces TTL, supports admin revoke, holds audit data, and is the source of truth.

The token is the **proof of holding**. The extension presents it on every signing request to prove "I am the holder of session X." The server validates the token signature and then consults its own session record (which may have been revoked even though the token hasn't expired).

A token whose corresponding server session has been revoked is rejected by the server even if the JWS is still cryptographically valid. The token is necessary but not sufficient.

**Known gap (PFL-172):** the session-token signing key is currently generated in process, so a token only verifies on the instance that issued it and silent signing works only on a warm container. Production requires a persistent key (Cloud KMS or Secret Manager) shared by all instances.

### 11.6 Always-On Policy Validation Pipeline

**This is the critical security invariant per ADR-0014.**

Every signing request — silent or fresh, first or fiftieth — runs the FULL pipeline server-side before any signature is recorded:

```typescript
// apps/functions/src/signing/validatePolicy.ts

async function validatePolicy(
  request: SignRequest,
  context: PolicyContext
): Promise<Result<PolicyDecision, PolicyError>> {

  // 1. Session validation (if session-claimed)
  if (request.sessionToken) {
    const sessionResult = await validateSessionToken(
      request.sessionToken
    );
    if (!sessionResult.ok) return sessionResult;

    // Re-fetch session record from Firestore — token
    // alone is not enough, server is authority
    const session = await getSession(sessionResult.value.sessionId);
    if (!session || session.status !== "active") {
      return err({ code: "SESSION_INVALID" });
    }
    if (session.expiresAt < now()) {
      return err({ code: "SESSION_EXPIRED" });
    }
    if (session.recipientSetHash !== request.recipientSetHash) {
      return err({ code: "SESSION_SCOPE_MISMATCH" });
    }
  }

  // 2. User active check
  const user = await getUser(request.userId);
  if (!user || user.status !== "active") {
    return err({ code: "USER_INACTIVE" });
  }

  // 3. Role check (may have changed since session opened)
  if (!user.role || user.companyId !== request.companyId) {
    return err({ code: "ROLE_INVALID" });
  }

  // 4. Authority limits
  if (request.isWireInstruction) {
    const amount = request.payload.wire.amount;

    // Per-email limit
    const limit = user.wireLimitUsd;
    if (amount > limit && !request.cosignSignatures?.length) {
      return ok({ decision: "COSIGN_REQUIRED", approvers: ... });
    }

    // High-value threshold (F-SES-07) — bypass session
    const policy = await getCompanyPolicy(request.companyId);
    if (amount > policy.highValueThresholdUsd) {
      if (!request.freshBiometric) {
        return err({ code: "FRESH_BIOMETRIC_REQUIRED" });
      }
    }

    // Daily aggregate
    const todaysTotal = await getDailyAggregate(
      request.userId, today()
    );
    if (todaysTotal + amount > user.dailyLimitUsd) {
      return err({ code: "DAILY_LIMIT_EXCEEDED" });
    }
  }

  // 5. Device validation
  const device = user.devices.find(
    d => d.credentialId === request.credentialId
  );
  if (!device || device.revokedAt) {
    return err({ code: "DEVICE_INVALID" });
  }

  // 6. Counterparty status
  const counterparty = await resolveCounterparty(
    request.recipientAddresses[0]
  );
  if (counterparty && counterparty.status !== "active") {
    return err({ code: "COUNTERPARTY_DEACTIVATED" });
  }

  // 7. Anomaly heuristics
  const anomaly = await checkAnomaly({
    userId: request.userId,
    velocity: { since: now() - 60_000 },
    payload: request.payload,
  });
  if (anomaly.flagged) {
    // Revoke the active session if any
    if (session) await revokeSession(session.sessionId,
      "anomaly", "system");
    return err({ code: "ANOMALY_FLAGGED" });
  }

  return ok({ decision: "APPROVED" });
}
```

**The function-level invariant:** sign API endpoints MUST call `validatePolicy` before validating the WebAuthn assertion. They MUST refuse to record the signature if validation fails. This is enforced by:

1. Code review checklist
2. Integration tests that send tampered session tokens, expired sessions, role-changed users, etc., and assert the API rejects them
3. Audit log review (every successful sign and every rejection emits an event; ratio is monitored)

**What "silent" actually skips:**

The session ONLY allows the WebAuthn ceremony to use `userVerification: "discouraged"`. The ceremony still happens. The signature still binds to the canonical payload. The policy still runs.

The session is purely a UX optimization for biometric prompts.

**Known gap (PFL-172 / PFL-041):** in `wiring/firestore-policy-context.ts` only `getUser` reads Firestore today. Company policy uses a built-in default, and daily totals, counterparty lookup, anomaly checks, session read/revoke and nonce dedupe are permissive in-memory implementations (nonces are not shared across instances). Wire limits are hardcoded ($500k per email / $2M daily). Production requires a Firestore-backed `PolicyContext` and a `companies/{id}.policy` document editable via the admin API.



---

## 12. Error Handling Strategy

(Result-type pattern, error taxonomy identical to v2.0 §11. Sentry captures all infrastructure errors automatically.)

---

## 13. Observability

### 13.1 Required Telemetry

```
proofline_verify_total       result, code     SLO + error rate
proofline_verify_duration    p50/p95/p99      Latency SLO
proofline_sign_total         result           Sign volume
proofline_sign_duration      p50/p95/p99      Sign latency
proofline_anchor_total       success/fail     Chain reliability
proofline_anchor_lag         seconds          SLO + alert
proofline_invitation_funnel  stage            Network growth
proofline_bilateral_state    transition       Adoption metric
proofline_kms_calls          result           KMS health
proofline_kyb_calls          provider, result Vendor reliability
proofline_email_sent         type, result     Notification health
```

### 13.2 Trace Span Naming

```
verify.GET
├─ registry.getCompany
├─ registry.getLatestAnchor
├─ chain.readAnchor
├─ verification.verifyEnvelope
│   ├─ verification.checkPayloadIntegrity
│   ├─ verification.checkSignatures
│   │   └─ crypto.verify (per signer)
│   └─ verification.checkPolicy
└─ render
```

### 13.3 Logging

Structured JSON only. Required fields per line: `timestamp, level, traceId, requestId, tenantId, userId, event, details, error?`. Never log PII or signature material.

---

## 14. Local Development

### 14.1 Required Environment

See `.env.example` for the manifest and §17.3 for every provider variable with its allowed values and defaults. The functions config module (§17.1) validates required variables at startup.

### 14.2 Running Locally

```bash
# Terminal 1 — Firebase emulators
firebase emulators:start

# Terminal 2 — admin web app (onboarding + admin console)
pnpm --filter @proofline/web-admin dev

# Terminal 3 — public verify page
pnpm --filter @proofline/web-verify dev

# Terminal 4 — counterparty portal (bilateral docs)
pnpm --filter @proofline/web-counterparty dev

# Terminal 5 — Chrome extension (rebuild on save)
pnpm --filter @proofline/extension-chrome dev

# Then in Chrome:
#   1. Navigate to chrome://extensions
#   2. Enable Developer Mode
#   3. Load Unpacked → select apps/extension-chrome/dist
#   4. Open mail.google.com — extension auto-injects
```

Emulators wire Functions ↔ Firestore ↔ Auth locally. The Anchor contract calls go to live Base Sepolia (cheap enough for dev).

External services in development (`PROOFLINE_ENV=development`):
- KYB → `KYB_PROVIDER=stub` by default; `baselayer` against the Baselayer sandbox (predefined test businesses only) or `cobalt` with a free Cobalt account
- IDV → `IDV_PROVIDER=stub` by default; `stripe` with Stripe test-mode keys
- Email → `EMAIL_PROVIDER=stub` by default; `resend` with a test domain
- Anchoring → Base Sepolia
- Sentry → dev project
- Gemini → real API (free tier), once PFL-028 lands

Development data (companies, users, devices) comes from a dev-only seed script against the emulators, not from skip buttons or fixture modes in the apps.

The extension uses live `proofline.app` for WebAuthn ceremony popups even in dev (because `localhost` doesn't work as a WebAuthn RP origin from a chrome-extension context). Set up a `dev.proofline.app` subdomain pointing to your dev Firebase Hosting deploy for end-to-end testing.

---

## 15. CI/CD Pipeline

### 15.1 GitHub Actions Workflow

(See `scaffolding/ci.yml` for the complete file.)

### 15.2 Required CI Gates

```
✓ Lint clean (eslint + prettier)
✓ Typecheck clean (tsc --noEmit)
✓ Unit tests pass (vitest)
✓ Golden vectors unchanged
✓ Contract tests pass (forge test)
✓ All apps build successfully
✓ No new high-severity dependency vulnerabilities
```

PRs cannot merge to main without all green.

---

## 16. Deployment Topology

### 16.1 Current Deployment

```
                  ┌────────────────────┐
                  │  Firebase Hosting   │
                  │  *.web.app          │
                  │   admin, sign,      │
                  │   verify,           │
                  │   counterparty      │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Firebase Functions │
                  │   (us-central1)    │
                  └─────────┬──────────┘
                            │
     ┌──────┬──────┬────────┼────────┬──────┬──────┐
     ▼      ▼      ▼        ▼        ▼      ▼      ▼
 Firestore KMS  Baselayer  Stripe  Resend Sentry  Base
               / Cobalt  Identity                Sepolia
               (KYB slot) (IDV slot)
```

Single region, single project. Cloud KMS and Base Sepolia are live. The KYB and IDV slots run on stub pending vendor access; Resend is not yet wired (PFL-160).

### 16.2 Production Delta

```
+ PROOFLINE_ENV=production with explicit providers and
  fail-closed config (§17)
+ All secrets bound via Functions defineSecret
+ Separate staging and production projects
+ Cloud KMS in dedicated keyring with IAM least-privilege
+ Cloud Armor / WAF in front of public verification endpoints
+ Cloud Trace + Cloud Monitoring + Sentry alerting
+ Later (Phase 10): Base mainnet anchoring, multi-region
  failover, SOC 2
```

---

## 17. Production Requirements & Configuration

The PRD states *what* production requires; this section states *how* the code meets it. Work is tracked in Phase 11 (Production Hardening); ticket references are given per item.

### 17.1 Config Module

All functions configuration is read in one module (`apps/functions/src/config/`, PFL-169) at cold start:

1. Read `PROOFLINE_ENV` and every provider variable from `process.env` and bound secrets.
2. Validate values against the allowed sets in §17.3. Unknown values are a startup error.
3. Apply production rules (§17.3 "Prod rule" column). A violation is a startup error — the function refuses to serve.
4. Log one line per slot (`[config] env=production KYB_PROVIDER=stub IDV_PROVIDER=stub EMAIL_PROVIDER=resend ...`). Secret values are never logged.
5. Export a frozen, typed `Config` object. No other module reads `process.env` directly; wiring code (today `wiring/stubs.ts`) builds providers from `Config` only.

There is no fallback chain (`a ?? b ?? "default"`) for anything security-relevant. The build (`esbuild.config.mjs`) fails for staging / production targets when required configuration is missing instead of deploying "with stubs".

### 17.2 `PROOFLINE_ENV`

`PROOFLINE_ENV=production|staging|development` must be set explicitly for every deployed function. Cloud Functions v2 does not set `NODE_ENV=production`, so `NODE_ENV` is never used to decide behaviour; existing `NODE_ENV` checks (e.g. the anchoring stub fallback) are replaced. A missing `PROOFLINE_ENV` is a startup error in deployed environments; only the local emulator may default to `development`.

### 17.3 Provider Environment Variables

| Variable | Allowed values | Default | Prod rule | Required secrets when real |
|---|---|---|---|---|
| `PROOFLINE_ENV` | `production` \| `staging` \| `development` | none (emulator: `development`) | must be `production` | — |
| `KYB_PROVIDER` | `stub` \| `baselayer` \| `cobalt` | `stub` | `stub` allowed but logged; stub-verified companies → `pending_review` (§7.1.5) | `BASELAYER_API_KEY`, `BASELAYER_WEBHOOK_SECRET` / `COBALT_API_KEY` |
| `IDV_PROVIDER` | `stub` \| `stripe` | `stub` | `stub` allowed but logged; stub-verified officers → `pending_review` | `STRIPE_SECRET_KEY`, `STRIPE_IDENTITY_WEBHOOK_SECRET` |
| `EMAIL_PROVIDER` | `resend` \| `stub` | `stub` (development only) | `stub` refused | `RESEND_API_KEY` (+ `RESEND_FROM_DOMAIN`) |
| `ANCHOR_PROVIDER` | `base-sepolia` \| `stub` (mainnet later) | `stub` (development only) | `stub` refused | `DEPLOYER_PRIVATE_KEY` (+ `BASE_SEPOLIA_RPC`, `ANCHOR_CONTRACT_ADDRESS`) |
| `KMS_PROVIDER` | `gcp` \| `stub` | `stub` (development only) | `stub` refused | IAM on the keyring (+ `KMS_PROJECT`, `KMS_LOCATION`, `KMS_KEYRING`) |

General rules:
- A real provider selected without its key is a startup error in every environment.
- Keys + env flip = live; no code change.
- Every stored verification result records `provider`.

Non-provider secrets (always required outside development, no defaults): `PROOFLINE_AUTH_JWT_SECRET`, `BILATERAL_JWT_SECRET`, `COSIGN_REFRESH_SECRET`, and the persistent session-token signing key (PFL-172).

### 17.4 Secrets

- Every secret is declared with `defineSecret()` from `firebase-functions/params` and listed in the function's `secrets: [...]` option. Today only `PROOFLINE_AUTH_JWT_SECRET` is bound this way.
- No hardcoded fallbacks. Literals such as `"dev-secret-change-in-prod"` in `jws.helpers.ts`, `cosign.helpers.ts`, `extension-auth.handler.ts`, `register-credential.handler.ts` and `require-extension-auth.middleware.ts` are removed (PFL-169).
- A missing secret is a startup error, not a warning.
- Secrets are set per project with `firebase functions:secrets:set`; `.env` files are for the local emulator only.
- Web apps receive only public configuration (Firebase web config, API base URL, Stripe publishable key) via build-time env; a missing value fails the build instead of falling back to a hardcoded project.

### 17.5 Auth Matrix

| Route group | Caller | Auth | Identity source | Today |
|---|---|---|---|---|
| `/v1/admin/*` (dashboard reads, invite-employee, revoke-device, update-role, update-status, revoke-session) | Web admin | Firebase ID token (`adminAuthMiddleware`); sensitive actions add fresh WebAuthn | Token UID → user record → `companyId` | Built |
| `/v1/onboard/*` | Web admin wizard | Firebase ID token | Token UID (owner); never `body.ownerUserId` or `?uid=` | Stub auth (`dev-user` / `dev-company`) — PFL-166 |
| `/v1/bilateral/*` (drafter side) | Web admin / portal | Firebase ID token | Token UID | Stub auth — PFL-166 |
| Bilateral counterparty sign | Counterparty portal | JWS link token + WebAuthn assertion | Derived server-side from token + assertion | Body / URL identity — PFL-166 / PFL-171 |
| `/v1/cosign/*` | Cosigner via link | JWS link token + verified WebAuthn assertion (rejected on failure) | Derived server-side | Assertion best-effort — PFL-171 |
| `/v1/sign`, `/v1/sign-silent` | Extension | Extension JWS (`requireExtensionAuth`) + session token where applicable | Token claims, re-checked against Firestore | Built |
| `/v1/extension/auth`, `/v1/extension/register-credential`, `/v1/auth/challenge` | Extension / sign popup | Firebase ID token → extension JWS; server-issued challenges | Token UID | Built |
| `/v1/verify/*`, public verify page | Anyone | None (read-only) | — | Built |
| `/v1/webhooks/kyb/*`, Stripe Identity webhook | Vendors | Vendor signature verification | Vendor reference lookup | Planned (PFL-162) |
| `anchorAdmin` (`/v1/admin/anchor/run`) | Platform operator | Platform-admin Firebase auth, or removed | Token UID | No auth — PFL-170 |

`stubAuthMiddleware` and the `dev-user` / `dev-company` identities are deleted. `LEGACY_DEMO_COMPANY_ID` and the `PLACEHOLDER_CREDENTIAL_ID` sentinel are removed; the extension forces credential registration instead of signing with a placeholder.

### 17.6 No Demo Paths in Production Builds

- `finalize` has no `demoMode`; it enforces ownership and every prior-step gate (PFL-167). The web-admin client no longer sends `demoMode`.
- No "skip" buttons in the onboarding wizard (PFL-168).
- Fixtures and fixture modes (`?fixture=`, `resolveMode()`, `DEV_PLACEHOLDER_TOKEN`) exist only under `import.meta.env.DEV` and are tree-shaken from production bundles. The counterparty portal defaults to live mode.
- No demo landing routes (`DemoHub`, fixture pages on `/`); public routes land on login or real pages.
- The extension never fabricates a "Verified" banner when the server returns none; it fails and retries.
- Explorer network, hosts, Chrome Web Store link and banner links come from config, not literals.
- Development data is created by a dev-only seed script.

### 17.7 Verification Strictness

- No unbounded legacy signature fallback. `legacySignatureFallback` is restricted to envelopes recorded before a fixed cutoff (and flagged in the result), or removed.
- Role credentials are signed by the company KMS root at registration (PFL-100.1); `trustUnsignedRoleCredentials` is removed and the issuer chain is always checked.
- The cosigner's WebAuthn assertion must verify or the cosign is rejected.
- Nonce replay protection is backed by Firestore, not per-instance memory (PFL-172).

### 17.8 Manual Review

- Companies whose KYB or IDV result came from the stub provider are set to `onboardingStatus = pending_review` in production and appear in the platform review queue (PFL-142, Phase 6 platform admin). They are never auto-approved.
- Real-provider results with `ok=false` or a flag of severity `medium` or higher go to the same queue.
- Approve / reject decisions are recorded with reviewer identity and timestamp in the audit log, and a company cannot finalize while `pending_review`.

---

## 18. Open Implementation Questions

(See PRD §18.2 — decisions captured as ADRs when resolved.)

---

## 19. Glossary

(Canonical glossary in the PRD. TDD-specific terms preserved from v2.0 §17.)

---

**Document status:** v4.0, production plan. Implementation should follow this document for the *how*; refer to PRD v4.0 for the *why*. Production hardening work is tracked in Phase 11 (§17).
