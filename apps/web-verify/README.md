# @proofline/web-verify

Public verification page for ProofLine signed envelopes and bilateral documents.

**URL:** `verify.proofline.web.app`

## Routes

| Route | Description |
|-------|-------------|
| `/v/:messageId` | Verify an email or wire envelope |
| `/b/:docId` | Verify a bilateral document |
| `/unverified-sender` | Static page for senders not on ProofLine |
| `/*` | 404 not found |

## Fixture query param (dev + demos)

Append `?fixture=<key>` to any `/v/` or `/b/` URL to force a fixture response instead of hitting the API.

| `?fixture=` key | State rendered |
|-----------------|----------------|
| `verified-wire` | Green verified badge, $250k wire instruction, single signer |
| `verified-email` | Green verified badge, signed email, single signer |
| `bilateral-banking` | Emerald bilateral badge, banking-change doc, two signers |
| `suspected-spoof` | Red suspected spoof, warning copy, no payload card |
| `rejected-tampered` | Red rejected, PAYLOAD_HASH_MISMATCH code |
| `rejected-expired` | Red rejected, PAYLOAD_EXPIRED code |
| `unverified-sender` | Neutral gray, sender not enrolled message |

Example: `http://localhost:5173/v/anything?fixture=bilateral-banking`

## Dev vs live mode

- **Dev** (`import.meta.env.DEV = true`): `fetchVerification()` defaults to fixture mode.
- **Prod**: `fetchVerification()` hits `GET /v1/verify/{id}`.
- Force fixtures in prod by appending `?fixture=<key>` to the URL.

## Local dev

```bash
pnpm --filter @proofline/web-verify dev
```

## Build

```bash
pnpm --filter @proofline/web-verify build
```

## Architecture

```
src/
  api/
    types.ts      ← HTTP-safe VerificationResponse (bigints as strings)
    fixtures.ts   ← 7 canned fixtures for dev/demo
    client.ts     ← fetchVerification() with dev/live mode toggle
  lib/
    format.ts     ← formatUSD, formatTimestamp, maskAccount, truncateHash
    basescan.ts   ← buildBasescanTxUrl, buildBasescanBlockUrl
  components/
    VerifyBadge   ← four-state pill (verified/bilateral/suspected_spoof/rejected/unverified_sender)
    VerifyHeader  ← badge + headline + subhead
    PayloadCard   ← renders wire, email, or bilateral payload
    SignerList    ← name, role chip, company, timestamp per signer
    AnchorReceipt ← block number, anchor root, Basescan link
    ErrorBoundary ← graceful failure wrapper
  routes/
    VerifyPage         ← /v/:messageId — full state machine
    BilateralPage      ← /b/:docId — explicit bilateral view
    UnverifiedSenderPage ← /unverified-sender — static
    NotFoundPage       ← 404
```

## Integration note for PFL-023

The real `GET /v1/verify/{id}` endpoint (PFL-023) should return a JSON shape matching `VerificationResponse` in `src/api/types.ts`. Specifically:
- `anchor.blockNumber` and `anchor.timestamp` must be serialized as **strings** (JSON does not support `bigint`).
- `state` must be one of: `verified`, `bilateral`, `suspected_spoof`, `rejected`, `unverified_sender`.
- The `unverified_sender` state is not part of `@proofline/verification`'s `VerificationResult` — the API layer adds it when no envelope exists for the given ID.
