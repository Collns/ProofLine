# `apps/functions/src/verify` — Public verification HTTP endpoint

Implements `GET /v1/verify/{id}`, the endpoint that
[`apps/web-verify`](../../../web-verify) consumes when not in fixture
mode. After this slice ships, the verify page works end-to-end against
real Firestore + Base Sepolia.

## Route

```
GET /v1/verify/:id
```

Public — no auth header. CORS:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Max-Age: 86400
```

Caching:

```
Cache-Control: public, max-age=60, s-maxage=300
```

The browser caches for 60 s; CDN can cache for 5 min. Revocations and
chain reorgs propagate within the window — fine for a verify badge.

## Response shape — five states

All five states return **HTTP 200**. `apps/web-verify` discriminates
on the `state` field. Only `INVALID_ID` (400) and unhandled exceptions
(500) return non-200.

### `verified` (single signature, valid)
```json
{
  "ok": true,
  "state": "verified",
  "signers": [{ "userId": "...", "companyDomain": "...", ... }],
  "payload": { "v": 1, ... },
  "anchor": {
    "root": "0x...",
    "blockNumber": "12847392",
    "timestamp": "1715040000"
  }
}
```

### `bilateral` (two-party signed document)
Same shape as `verified`; `signers` has the two counter-signers and
`payload` is a `BilateralPayload`.

### `suspected_spoof` (verified domain, signature failed)
```json
{
  "ok": true,
  "state": "suspected_spoof",
  "claimedCompany": {
    "companyId": "acme-title",
    "domain": "acme-title.com",
    "legalName": "Acme Title LLC"
  },
  "detail": "..."
}
```

### `rejected` (failure with code)
```json
{
  "ok": false,
  "state": "rejected",
  "code": "PAYLOAD_HASH_MISMATCH",
  "detail": "..."
}
```

`code` is one of the `VerificationFailureCode` values from
`@proofline/verification`.

### `unverified_sender` (no envelope at this id)
```json
{ "ok": true, "state": "unverified_sender" }
```

Distinct from `404`. The verify page renders a neutral "we have no
record" surface — not an error.

## Architecture

```
GET /v1/verify/:id
        │
        ▼
verify.handler.ts            ← express handler; CORS + cache headers
        │
        ▼
service-factory.ts           ← fetchEnvelope() + RegistryView
        │   ┌──────────────┐
        ├──▶│ Firestore    │  signed_messages/, bilateral_documents/,
        │   │ (read-only)  │  companies/, users/, role_credentials/,
        │   └──────────────┘  revocations/, nonces/, anchors/
        │
        ▼
registry-view.ts             ← Firestore-backed RegistryView impl
        │
        ▼
verifyEnvelope()             ← @proofline/verification (algorithm)
        │
        ▼
shape-response.ts            ← VerificationResult → VerificationResponse
                                 (bigints → strings, strip internals)
```

### Read-only by construction

The verify endpoint **must never mutate Firestore**. The
`RegistryView` interface from `@proofline/verification` does not expose
a `recordNonce` write hook — the `isNonceUsed()` reader is the only
nonce surface this view implements. Nonce *writes* happen on the sign
path; the verify path only checks for replay.

### Anchor confirmation

`getAnchorForRoot(root)` calls the on-chain reader (viem against Base
Sepolia) — Firestore is **not authoritative** for anchor existence.
If Firestore says a root is anchored but chain disagrees, chain wins
and `verifyEnvelope` returns `ANCHOR_NOT_ON_CHAIN`.

## Firestore document shapes (assumed)

This slice assumes the following shapes. Plant fixtures matching them
for the demo if they don't exist yet — see
`apps/functions/src/api/onboarding/start.handler.ts` for `companies/`
shape (closest neighbour).

```
companies/{companyId}
  { companyId, domain, legalName, rootPublicKey, status, verifiedAt }

users/{userId}
  { userId, companyId, displayName, role, status }

users/{userId}/role_credentials/{credentialId}
  RoleCredential   (per @proofline/types)

revocations/{credentialId}
  { revokedAt }

nonces/{nonce}
  { usedAt }

anchors/{anchorId}
  { root, blockNumber, timestamp, sequence }   (sequence orders for getLatestAnchor)

signed_messages/{messageId}
  SignedEnvelope   (per @proofline/types)

bilateral_documents/{docId}
  SignedEnvelope   (payloadType="bilateral")
```

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Router factory, public exports |
| `handlers/verify.handler.ts` | Express GET handler with headers, error mapping |
| `handlers/http.helpers.ts` | RFC 7807 error helpers + `isValidVerifyId` |
| `registry-view.ts` | Firestore-backed `RegistryView` impl |
| `shape-response.ts` | `VerificationResult` → `VerificationResponse` |
| `unverified-sender.ts` | The 5th-state response builder |
| `service-factory.ts` | Wires registry + envelope fetch |
| `contract.ts` | The HTTP response type (mirrors `apps/web-verify`'s) |
| `tests/*.test.ts` | Integration + unit tests |
