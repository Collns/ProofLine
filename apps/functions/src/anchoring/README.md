# `apps/functions/src/anchoring`

Wires `@proofline/anchoring` (Merkle tree + Base Sepolia client) into the
Firebase Functions runtime so registry events get periodically rolled up
into a Merkle root and posted to the deployed `Anchor.sol` contract.

This is the **wireup slice** (PFL-027). Both ends already exist; this
module composes them.

## Files

| File                  | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `batch.ts`            | Pure logic. Sorts events, builds Merkle tree, derives a `BatchPlan`.    |
| `post-anchor.ts`      | Submits root on-chain, writes `AnchorRecord` to Firestore, marks events.|
| `run-batch.ts`        | Shared "run one cycle" used by both the scheduler and the manual API.   |
| `scheduler.ts`        | `firebase-functions/v2/scheduler.onSchedule` — every 5 minutes.         |
| `manual.ts`           | Express handler — `POST /v1/admin/anchor/run`.                          |
| `service-factory.ts`  | Env-based selection of real (viem) vs stub providers; Firestore store.  |
| `index.ts`            | Public exports.                                                         |

## Cadence (5-minute schedule)

The scheduled function `anchorBatchScheduler` runs every 5 minutes
(see `scheduler.ts`). On each tick:

1. `EventSource.collectUnanchoredEvents()` — drains the `anchor_queue/`
   Firestore collection (one entry per envelope, written by
   `signing.helpers.ts:queueAnchorBatch`).
2. If empty → log `anchor.run.empty` and exit.
3. Otherwise, builds a `BatchPlan`, calls `postAnchorBatch`:
   - **Success** → writes `anchors/{recordId}` and deletes the queue
     entries (via `markEventsAnchored`).
   - **`CHAIN_TX_FAILED` / `CHAIN_TIMEOUT`** → logs error, does **not**
     write the record, leaves queue intact. The next 5-min tick retries.
   - **`ALREADY_ANCHORED`** → finds the existing record by Merkle root
     and marks the queue entries against it. This is the "retry
     succeeded but we lost the receipt last time" path.

SLO target (TDD §14.1): anchor confirmation lag < 10 min.
5-min cadence + ~30s tx confirmation = comfortably under SLO.

## Manual trigger — `POST /v1/admin/anchor/run`

Exported from `apps/functions/src/index.ts` as `anchorAdminApi`.
Same code path as the scheduler — `runAnchorBatchOnce(deps)`.

Two demo use cases (TDD §6.3 demo anti-failure plan):

1. **Pre-anchor demo fixtures** — 30 minutes before the demo, run the
   manual trigger so all fixture envelopes are already anchored on
   Base Sepolia. The demo verify page then renders "anchored" pills
   instead of "pending."
2. **Live demo climax** — "let me trigger an anchor right now" — the
   on-stage moment where you POST to this endpoint and refresh the
   verify page to show the new on-chain receipt.

Auth: hardcoded ALLOW for the hackathon. Post-hackathon: gate behind
admin role + WebAuthn fresh assertion (PRD §6.8 F-ADM-03).

### Response shapes

Empty registry:
```json
{ "ok": true, "message": "no events to anchor", "leafCount": 0 }
```

Anchored:
```json
{
  "ok": true,
  "recordId": "anchor_…",
  "sequence": 42,
  "root": "0x…",
  "txHash": "0x…",
  "leafCount": 17
}
```

Failure:
```json
{ "ok": false, "error": { "code": "CHAIN_TX_FAILED", "detail": "…" } }
```

## Env vars consumed

| Var                       | Purpose                                  |
|---------------------------|------------------------------------------|
| `BASE_SEPOLIA_RPC`        | RPC URL for viem provider                |
| `DEPLOYER_PRIVATE_KEY`    | Wallet that signs anchor txs             |
| `ANCHOR_CONTRACT_ADDRESS` | Deployed `Anchor.sol` address            |
| `FIREBASE_PROJECT_ID`     | Firestore (set automatically by Functions) |

If any of the first three are missing AND `NODE_ENV !== 'production'`,
the factory transparently falls back to the in-memory stub provider so
local dev / tests don't need a real wallet. In production, missing env
throws.

## Firestore schema introduced

- `anchors/{recordId}` — see `AnchorRecord` shape in `post-anchor.ts`.

The spec ultimately wants `anchored: boolean, anchorRecordId?: string`
fields on every registry-event-bearing collection (envelopes,
role_credentials, revocations). Today the codebase tracks unanchored
work via the explicit `anchor_queue/` push collection, which this
module drains. Adding `anchored` fields to the source collections is
deferred to a follow-up migration; the `AnchorStore` interface is
abstract so the migration won't require changes here.

## Followups discovered during this slice

1. **`@proofline/anchoring` package exports.** The viem provider lives
   at `packages/anchoring/src/providers/viem-base-sepolia.ts` but the
   package's `package.json` does not declare it as a subpath export.
   `service-factory.ts` lazy-loads it via `createRequire` against the
   `dist/` path — works, but a one-line change to add
   `"./providers/viem-base-sepolia": "./dist/providers/viem-base-sepolia.js"`
   would let us drop the workaround.
2. **Migration: `anchored` flags on source collections.** See note above.
3. **Onboarding finalize anchor coupling.** `finalize.handler.ts:230`
   currently does an inline single-event anchor and proceeds even if
   `postAnchor` fails (with a "Will retry via batch" log). Once this
   batch job is in production, finalize should **not** anchor inline
   at all — just enqueue. Out of scope for this slice.
4. **Admin auth.** `manual.ts` is currently unauthenticated. PRD
   §6.8 F-ADM-03 requires admin role + fresh assertion.
