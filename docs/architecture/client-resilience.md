# Client resilience: surviving Gmail / Outlook changes

**Status:** design / research. Plan only — nothing here is built yet.
**Scope:** keep ProofLine's "don't let unsigned mail leave quietly" guarantee working as Gmail and Outlook change their DOM and send surfaces, and add defense-in-depth that does not depend on the client at all.
**Related:** PFL-096/181/188/190 (Gmail send guard + unsigned-email policy), PFL-152/153 (Outlook), F-EXT-03 / F-EXT-09.

---

## 1. What we depend on today (Gmail)

Our Gmail integration is a content script that hand-matches Gmail's DOM:

| Concern | Where | What it keys off |
|---|---|---|
| Find composes (new / inline reply / forward / pop-out) | `content/gmail-detector.ts` | `role="dialog"`, inline `tr.btC` toolbars, `role="textbox"` body, `input[name="subjectbox"]` |
| Inject the Sign button + wire fields | `content/inject-toolbar.ts` | toolbar selectors, with a 3s fallback + "ProofLine extension needs an update" notice (F-EXT-09) |
| Block/allow Send | `content/send-guard.ts` | capture-phase `mousedown/mouseup/click` on `[role="button"]` whose `data-tooltip`/`aria-label` starts with "Send", plus `Ctrl/Cmd+Enter` |
| Warn-mode one-click send | `content/send-guard.ts` | **programmatic `.click()` of Gmail's own Send button** (PFL-190) |
| Classify compose type (audit) | `content/compose-type.ts` | `role="dialog"` `aria-label`, `subjectbox` value heuristics |
| Extract canonical payload | `content/extract-payload.ts` | `innerText` of the body editable; recipient chips via `[email]` |
| Inbound verified badge | `content/inject-badge.ts` | `data-proofline-banner="true"`, `data-message-id` |
| Signed-mail signal | `background/index.ts` | **in-body banner table** (`data-proofline-banner`) + verify URL `proofline-verify.web.app/v/<hash>` — **there is no custom email header today** |

Every row above is a selector or behavior Gmail can change without notice. We already degrade gracefully (fallback selectors + update notice + fail-closed policy), but a silent selector drift on the **Send button** or the **toolbar** is the high-severity case: if we stop recognizing Send, the guard stops blocking; if we stop finding the toolbar, the Sign button never appears.

Two facts that shape everything below:
- **The client cannot add SMTP/internet headers to Gmail outbound mail.** Our only on-the-wire signal is in-body HTML. (Outlook add-ins *can* set internet headers — see §4.)
- A true "hard block the user cannot override" is **not** publishable to either the Chrome Web Store or Microsoft Marketplace for an add-in; both require an escape hatch. Our block mode is as strict as the platform allows, not an absolute.

---

## 2. Option A — migrate the Gmail integration to InboxSDK

[InboxSDK](https://www.inboxsdk.com/) is a library that abstracts Gmail's DOM behind a stable API and (in its hosted model) updates its selectors server-side so individual extensions don't break on every Gmail change.

### What it would replace

| Today | InboxSDK equivalent |
|---|---|
| `gmail-detector.ts` compose detection | `sdk.Compose.registerComposeViewHandler(composeView => …)` |
| `inject-toolbar.ts` toolbar discovery + button placement | `composeView.addButton({ title, onClick })` |
| `send-guard.ts` capture-phase Send interception | `composeView.on('presending', e => e.cancel())` |
| warn-mode programmatic Send click | `composeView.send()` |
| `compose-type.ts` heuristics | `composeView.isReply()` / `isInlineReplyForm()` / `getThreadID()` |
| `inject-badge.ts` inbound detection | `sdk.Conversations` / message-view handlers |
| fallback selectors + "needs update" notice | handled upstream by the SDK (but see MV3 caveat) |

The appeal is concentrated in two rows: the SDK's `presending` event and `composeView.send()` are a far more robust version of exactly the two things PFL-190 does by hand (intercept Send, re-send programmatically), across all compose surfaces, maintained by someone who tracks Gmail changes for us.

### Chrome Web Store / MV3 implications — the deciding factor

- **MV3 bans remotely-hosted code.** Per Chrome, "all of your extension's logic must be part of the extension package… you can no longer load and execute remotely hosted files" ([Chrome: improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)).
- **InboxSDK's classic build remote-loads its `platform.js`** — that pattern (`InboxSDK.loadScript(...)`) is the legacy, MV2, non-npm release and is **not CWS-compliant under MV3**.
- InboxSDK shipped an **npm MV3 build** that bundles its code locally instead of remote-loading it ([InboxSDK MV3 beta announcement](https://groups.google.com/g/inboxsdk/c/MAT_zImFu5I/m/N_7nDojRAgAJ); [getting started](https://github.com/InboxSDK/inboxsdk-docs/blob/main/docs/getting-started.md)). **This is the only version we would consider.**
- **Trade-off we lose by going MV3-compliant:** the announcement states the MV3 build cannot remote-load executable code, so it remote-loads *declarative configuration* (selectors) and **"developers will need to release an extension update whenever they need a new version of the InboxSDK."** So the headline benefit — automatic selector updates without shipping an extension update — is **weaker under MV3**: executable logic is pinned to the version we bundle; only data-shaped config may refresh, and whether CWS review accepts even that config-fetch is a review-time risk (one developer reported CWS flagging a mere CDN *string* in a bundled dependency — [ChatShuttle](https://www.chatshuttle.ai/blog/chrome-store-remote-code)).
- **Licensing:** InboxSDK's npm package is MIT-licensed — **verify the `LICENSE` in the exact version we pin**, and whether any hosted-config terms apply.

### Assessment

InboxSDK buys us a battle-tested `presending`/`send()` path and broad surface coverage, and retires a lot of brittle selector code. But under MV3 it does **not** eliminate the "ship an update when Gmail changes" problem, it adds a dependency whose config-fetch could draw CWS-review scrutiny, and it does not help Outlook at all. **Recommendation: a time-boxed spike, not a commitment** — port *only* the send-guard path behind our existing `SendGuardDeps` seam, measure review acceptance and behavior parity (especially the warn one-click and inline composes), then decide. Our code is already structured so the detector and send interception are swappable.

---

## 3. Option B — scheduled real-Gmail smoke check + selector telemetry (do this first)

The cheapest, highest-leverage item: **know within a day when Gmail breaks us**, instead of finding out from a user.

### B1. Daily synthetic smoke check
A scheduled job (GitHub Actions cron, or Playwright against a test Google account) that loads the built extension in a real Chromium + Gmail session and asserts the invariants:
1. Opening a new compose injects the Sign button (toolbar found).
2. Gmail's Send button is detected (`isGmailSendButton` matches a real button).
3. An unsigned send under `block` is actually blocked.
4. The warn one-click path sends.

On failure → alert (Slack/email/page). This is the one check that catches *selector drift we didn't write a unit test for*, because it runs against live Gmail. Caveats: needs a dedicated test Google account + stored auth (brittle, 2FA); treat flakes as "investigate", not "page", and require 2 consecutive failures before alerting.

### B2. Field telemetry for "selector not found"
We already set `TOOLBAR_NOT_FOUND_MARKER` and show the update notice. Add a privacy-safe counter (no message content, no PII): increment a `selector_miss` event (surface = toolbar / send-button / body / recipient-chips) and batch-report counts to an extension-telemetry endpoint. A spike in `selector_miss` across installs is the real-world signal that Gmail changed, ahead of the smoke check. Fold this into the existing fail-closed path so a miss also tightens behavior, not just reports.

This option is independent of A, C and D and makes all of them safer, so it goes first.

---

## 4. Option C — Outlook via Office.js Smart Alerts (PFL-152/153)

Outlook add-ins get a first-class send event — no DOM scraping — via **Smart Alerts** `OnMessageSend` ([Microsoft Learn: OnMessageSend/OnAppointmentSend](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/onmessagesend-onappointmentsend-events)).

### Shape
- Declare the event in the manifest with a **`SendMode`** (add-in-only manifest `LaunchEvent`) / **`sendMode`** (unified manifest `autoRunEvents`). Publishable values: **`PromptUser`** and **`SoftBlock`**. Requires Mailbox requirement set ≥ 1.12 (walkthrough pins 1.15).
- The handler runs on send and calls `event.completed({ allowEvent: true | false, errorMessage })`.

### Mapping our policy — and its hard constraints
| ProofLine policy | Outlook behavior | Note |
|---|---|---|
| `allow` | `allowEvent: true`, no prompt | send normally |
| `warn` | show message, `allowEvent: false` under `PromptUser` → user clicks **Send Anyway** | one-click override, matches our warn |
| `block` | `allowEvent: false` under `SoftBlock` → user must sign first | strictest publishable form |

Three constraints to design around, all confirmed in Microsoft's docs/issues:
1. **`sendMode` is static in the manifest — you cannot switch `PromptUser`↔`SoftBlock` per company at runtime.** You pick one. The "Send Anyway" affordance only appears if **all** installed Smart Alerts add-ins use `PromptUser` ([docs](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/onmessagesend-onappointmentsend-events)). So a single manifest cannot give warn its one-click override *and* give block a no-override block. Decision needed: ship `SoftBlock` (favor block; warn degrades to "open the task pane and confirm") or `PromptUser` (favor warn; block becomes overridable). Recommendation: **`SoftBlock`**, to match our block-by-default posture; implement warn as an in-handler informational prompt.
2. **`SoftBlock` fails *open* on outage** — "lets users send during an outage when the add-in is unavailable." That is the opposite of our Gmail fail-closed stance, and a true fail-closed is **not publishable**. Document this as an accepted limitation of the Outlook path (or require server-side enforcement, §5, to cover it).
3. **No mobile Outlook support**, and there are live reliability issues in **New Outlook for Mac** (`OnMessageSend` reportedly not firing — [office-js #7000](https://github.com/OfficeDev/office-js/issues/7000)) and classic-Outlook runtime quirks (ES2016, no async/await — use promises — [#5748](https://github.com/OfficeDev/office-js/issues/5748)). Plan a support matrix: Windows new/classic, OWA, Mac — and gate the rollout on per-client testing.

**Upside unique to Outlook:** add-ins *can* set custom internet headers on the outgoing item, which feeds §5 directly (unlike Gmail).

Sources: [Smart Alerts walkthrough](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/smart-alerts-onmessagesend-walkthrough), [on-send add-ins](https://github.com/OfficeDev/office-js-docs-pr/blob/main/docs/outlook/outlook-on-send-addins.md).

---

## 5. Option D — server-side / platform enforcement (defense-in-depth)

The only enforcement that survives the client breaking entirely: have the mail platform itself reject or quarantine outbound mail that isn't ProofLine-signed. This is **admin-configured on the customer's tenant**, so it's an enterprise feature, not something we flip.

### Prerequisite we don't have yet
Signed mail must carry a **stable, machine-checkable marker**. Today that's only an in-body banner + verify URL — fragile to match and absent from headers.
- **Add a signed-mail header**, e.g. `X-ProofLine-Signature: v=1; env=<id>; hash=<payloadHash>`. **Gmail content scripts cannot inject headers**, so for Gmail this likely requires sending via the Gmail API path (large) or keying the compliance rule off the in-body verify URL instead (brittle but zero-client-change). **Outlook add-ins can set the header** via the internet-headers API — so the header approach is natural on Outlook, body-match is the Gmail fallback. This split is the main design question for D.

### Exchange Online / Microsoft 365 — feasible
Mail-flow (transport) rules can test headers and **reject** ([conditions](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/conditions-and-exceptions), [actions](https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rule-actions)). There is no direct "header is absent" condition, so use the standard inversion: **apply to all outbound mail, *except if* a message header matches the ProofLine pattern → reject/quarantine.** Automatable via **Exchange Online PowerShell `New-TransportRule`** ([ref](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-transportrule)) — so we could offer guided setup or a script. (No Graph API for transport rules.)

### Google Workspace — feasible, manual
**Content compliance** rules can match on **Full headers** with a regex and **reject** outbound ([advanced content filtering](https://support.google.com/a/answer/1346934), [control by content](https://support.google.com/a/answer/1346936)). Absence is handled by the rule's match-type inversion (match messages that do **not** contain the marker → reject/quarantine); each header field is matched one-at-a-time, so keep the marker single-field. **No public API** for content-compliance settings — Admin console only — so Google is a **documented admin runbook**, not automated setup.

> Both inversions ("reject unless the marker is present") must be **verified in a real tenant** before we publish a runbook — the negation/except path is confirmed to exist in the feature set but not in a single doc page.

### Why D matters
It's the only layer that holds when a Gmail update silently disables the content script, when a user disables the extension, or when Outlook `SoftBlock` fails open during an outage. It doesn't replace the client (which gives the pre-send UX, signing, and the recipient footer) — it's the backstop.

---

## 6. Recommended order

1. **B — smoke check + telemetry (now).** Cheapest, and it protects every other workstream by telling us fast when a client breaks. No dependencies.
2. **D — server-side enforcement, starting with the signed-mail header + the Exchange path.** Highest durability; the header prerequisite also unblocks the Outlook header story. Pilot Exchange `New-TransportRule` with one design-partner tenant; write the Google runbook in parallel.
3. **A — InboxSDK spike (time-boxed), decide after.** Port only the send-guard path behind `SendGuardDeps`; keep or drop based on CWS-review acceptance and parity. Not worth a full migration until the spike clears the MV3/review risk.
4. **C — Outlook Smart Alerts (PFL-152/153), when the Outlook milestone is scheduled.** Uses the §5 header; design to the `SoftBlock` + fail-open + no-mobile constraints from day one.

Rationale: B and D reduce risk no matter what the clients do; A and C are client-specific and each carries platform risk (MV3 review; Smart Alerts reliability) that B/D de-risk by giving us detection and a backstop first.

---

## 7. Proposed Kanban tasks

(For the ProofLine Hackathon board, Phase 11 / production-hardening. Proposed, not created — see session notes.)

- **PFL-191 — Gmail integration resilience: daily smoke check + selector telemetry** (high). B1 synthetic real-Gmail check of the four invariants + alerting with a 2-failure threshold; B2 privacy-safe `selector_miss` telemetry wired into the existing fail-closed path. _Done when: a deliberately broken selector trips an alert within a day and increments the counter._
- **PFL-192 — Signed-mail marker: add `X-ProofLine-Signature` header + decide Gmail strategy** (high). Define the header; set it on paths we control; decide Gmail (Gmail-API send vs. body-match fallback). Prereq for PFL-193/PFL-153-header. _Done when: a signed message carries a deterministic, documented marker a mail rule can match._
- **PFL-193 — Server-side enforcement: Exchange transport-rule pilot + Google runbook** (medium). "Reject unless ProofLine marker present" via `New-TransportRule` (scripted) and a verified Google content-compliance runbook; verify both inversions in a real tenant. Depends on PFL-192. _Done when: outbound unsigned mail is rejected on a pilot tenant on each platform._
- **PFL-194 — Spike: InboxSDK (MV3 npm build) for the Gmail send guard** (medium). Port only the `presending`/`send()` path behind `SendGuardDeps`; assess CWS-review acceptance, licensing, parity on warn one-click + inline composes. Timebox ~3 days; output a keep/drop recommendation. _Done when: a decision memo + a working branch (or a documented blocker) exists._
- **PFL-195 — Outlook Smart Alerts design for PFL-152/153** (medium). Manifest `sendMode` decision (recommend `SoftBlock`), policy→behavior mapping, the fail-open-on-outage + no-mobile + Mac-reliability constraints, and the client-set header from PFL-192. _Done when: PFL-152/153 have an agreed design to build against._
