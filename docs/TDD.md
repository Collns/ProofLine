# ProofLine — Technical Design Document

**Version:** 3.2 (Email-first pivot — extension as primary compose surface)
**Companion to:** PRD.md v3.2
**Audience:** Engineers, reviewers, AI coding assistants
**Scope:** Implementation details, contracts, integrations, deployment
**Supersedes:** v3.0, v3.1

---

## Changelog from v3.0

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
- `docs/PRD.md` v3.2 — product requirements
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
│ Adapter pattern for        →   Middesk, Stripe, Resend,  │
│ external services               Sentry all swappable     │
│                                                          │
│ Time and randomness        →   Tests don't depend on     │
│ are injected                    now() or Math.random()   │
└──────────────────────────────────────────────────────────┘
```

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
   │ Cloud  ││Stripe││Mid-  ││Resend││Sen-││  Base   │
   │ KMS    ││ID    ││desk  ││      ││try ││  Sep.   │
   └────────┘└──────┘└──────┘└──────┘└────┘└─────────┘

   Web admin app (app.proofline.web.app) used for:
    ─ Onboarding wizard (DNS, KYB, Stripe IDV, KMS)
    ─ Admin dashboard (users, devices, sessions, wires,
      bilateral docs, invitations)
    ─ Counterparty invitation management
    ─ Session admin (view, revoke, configure)
   NOT used for: drafting/signing emails (extension does this)
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

### 4.6 `@proofline/kyb` — NEW DETAIL

```typescript
export interface KYBProvider {
  verifyBusiness(input: BusinessLookupInput): Promise<BusinessVerification>;
  verifyOfficer(input: OfficerKYCInput): Promise<OfficerVerification>;
}

export type BusinessLookupInput = {
  legalName: string;
  ein: string;
  state: string;
  country: "US";
};

export type BusinessVerification = {
  ok: boolean;
  vendorRef: string;             // e.g. Middesk business ID
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

Implementations:
- `@proofline/kyb/providers/middesk.ts` — Middesk for `verifyBusiness`
- `@proofline/kyb/providers/stripe-identity.ts` — Stripe Identity for `verifyOfficer`
- `@proofline/kyb/providers/composite.ts` — Composes both into a single provider
- `@proofline/kyb/providers/stub.ts` — Deterministic for tests

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
Owner    Web Sender    Functions    Middesk    Stripe ID    KMS    Chain    Resend
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
 │           │             │                 │ Middesk runs:                    │
 │           │             │                 │ - Sec of State                   │
 │           │             │                 │ - EIN match                      │
 │           │             │                 │ - sanctions                      │
 │           │             │◀─verification───│                                  │
 │           │             │ store result    │                                  │
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

### 5.2 Sign + Co-Sign

```
Sarah    Web Sender    Functions    Firestore    Resend    Bob's email/phone
  │          │             │           │           │              │
  │─compose─▶│             │           │           │              │
  │          │─/draft─────▶│           │           │              │
  │          │             │─create wire▶          │              │
  │          │◀─wire+id────│                                      │
  │          │ amount > Sarah's limit → cosign required           │
  │          │─/request-cosign▶                                   │
  │          │             │─sendCosignRequest────▶│              │
  │          │             │                       │─email────────▶
  │          │                                                    │
  │ (Sarah waits)                                                 │
  │                                                               │
  │                                              │ Bob clicks link│
  │                                              │ shows EXACT    │
  │                                              │ payload        │
  │                                              │                │
  │                                              │ biometric      │
  │                                              │                │
  │          │             │◀─/sign(assertion)───────────────────│
  │          │             │ verify Bob's role + sig             │
  │          │             │ append both sigs to envelope        │
  │          │             │ trigger anchor batch                │
  │          │◀─signed─────│                                     │
  │◀─link────│                                                   │
```

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

## 7. External Integrations — Implementation Detail

### 7.1 Middesk

```typescript
// packages/kyb/src/providers/middesk.ts
export function makeMiddeskProvider(config: { apiKey: string }): KYBProvider {
  return {
    async verifyBusiness(input) {
      const res = await fetch("https://api.middesk.com/v1/businesses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.legalName,
          tin: { tin: input.ein },
          addresses: [{ state: input.state }],
        }),
      });
      const data = await res.json();
      // Poll until status === 'completed' (Middesk is async)
      const final = await pollUntilComplete(data.id, config.apiKey);

      return {
        ok: final.status === "completed" && final.review_status === "approved",
        vendorRef: final.id,
        flags: extractFlags(final),
        officers: extractOfficers(final),
        raw: final,
      };
    },
    verifyOfficer: async () => { throw new Error("Use stripe-identity provider"); },
  };
}
```

Sandbox: `https://api-sandbox.middesk.com`. Webhook for async completion supported.

### 7.2 Stripe Identity

```typescript
// packages/kyb/src/providers/stripe-identity.ts
import Stripe from "stripe";

export function makeStripeIdentityProvider(config: { secretKey: string }): KYBProvider {
  const stripe = new Stripe(config.secretKey, { apiVersion: "2024-06-20" });

  return {
    verifyBusiness: async () => { throw new Error("Use middesk provider"); },
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

### 7.6 Gemini

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

Counterparty receives a signed link:
```
https://counterparty.proofline.web.app/sign/{docId}?t={signedToken}
```
Token is a JWS signed by inviter's company root, scoping access to one document. Signing surface MUST follow the 6-step pre-biometric verification per ADR-0010 (re-fetch + re-verify before triggering WebAuthn ceremony).

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

See `scaffolding/env.example` for the full manifest. Bootstrap script verifies all required vars before allowing any app to start.

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

External services in dev mode:
- Middesk → sandbox API
- Stripe Identity → test mode
- Resend → "test" mailbox
- Sentry → dev project
- Gemini → real API (free tier)

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

## 17. Open Implementation Questions

(See PRD v3.0 §18.2 — same list, decisions captured as ADRs when resolved.)

---

## 18. Glossary

(Canonical glossary in PRD v3.0 §19. TDD-specific terms preserved from v2.0 §17.)

---

**Document status:** v3.0, integration-ready. Implementation should follow this document for the *how*; refer to PRD v3.0 for the *why*. Begin Day Zero per `scaffolding/bootstrap.sh`.
