# @proofline/web-sign

WebAuthn ceremony surface for the Chrome extension. Hosts the
`navigator.credentials.get()` ceremony at a URL whose origin matches
the WebAuthn RP ID — the extension's `chrome-extension://*` origin
cannot serve as the RP, so this app does it instead.

## Routes

| Route                  | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `/sign/start`          | Fresh biometric (UV: `required`). Opens a per-recipient session.   |
| `/sign/silent`         | In-session ceremony (UV: `discouraged`). Renders minimal UI.       |
| `/extension/auth`      | First-install extension auth (stub — see PFL-AUTH-LOGIN).          |

URL params (per `apps/extension-chrome/src/shared/ceremony.types.ts` —
the source of truth for the extension↔popup contract):

```
?kind=fresh|silent|auth
&ceremonyId=<uuid>
&extInstallId=<chrome.runtime.id>
&returnOrigin=chrome-extension://<id>
&recipientSetHash=<sha256-hex>     // fresh | silent
&payloadHash=<sha256-hex>          // fresh | silent
&payloadB64=<base64url-canonical-EmailPayload-JSON>
&credentialId=<webauthn-cred-id>   // fresh | silent
&extToken=<bearer>                 // fresh | silent
&sessionToken=<jws>                // silent only
```

## Security boundaries

**Page-load gate (`src/lib/opener-validator.ts`).** Before touching any
URL data, the page checks:

1. `window.opener != null` — the page must have been opened by a
   launcher, not surfed to directly.
2. `extInstallId` matches `^[a-p]{32}$` — the chrome-extension ID
   format that the browser controls and a hostile origin cannot forge.
3. `returnOrigin === "chrome-extension://" + extInstallId` exactly —
   no path, no query, no hash.

Cross-origin restrictions block reading `window.opener.location.origin`,
so the chrome-extension ID format check + delivery-mechanism binding
(below) is what binds the response to the launcher.

**Hash re-verification (ADR-0010).** The popup decodes `payloadB64`,
recomputes its sha256, and compares to `payloadHash` — never trusts the
URL hash directly. Then it POSTs the decoded payload to `/v1/sign` (or
`/v1/sign-silent`); the server independently recomputes the canonical
hash and binds the issued challenge to ITS hash, not ours. If anything
between extraction and ceremony tampered with the payload, the
challenge mismatches and finalize fails.

**Delivery (`src/api/postmessage.ts`).** Two delivery paths in priority
order:

1. **`chrome.runtime.sendMessage(extInstallId, response)`** — production
   path, matches the typed contract in
   `apps/extension-chrome/src/shared/ceremony.types.ts`. Requires the
   extension to declare `externally_connectable.matches` for this
   page's origin.
2. **`window.opener.postMessage(response, returnOrigin)`** — typed
   fallback for non-extension contexts (Playwright harness, dev
   iframe). **Always** specifies an explicit `chrome-extension://`
   `targetOrigin`. Never uses `'*'`.

The `CeremonyResponse` shape MUST match the extension's typed contract
exactly:

```ts
type CeremonyResponse =
  | { kind: 'auth_success';   ceremonyId; authToken; userId; companyId }
  | { kind: 'sign_success';   ceremonyId; envelope; banner; sessionToken? }
  | { kind: 'verify_success'; ceremonyId; result }
  | { kind: 'user_cancelled'; ceremonyId }
  | { kind: 'error';          ceremonyId; code; message };
```

If those names ever drift between this file and
`apps/extension-chrome/src/shared/ceremony.types.ts`, the bridge breaks
silently — both sides must change in lockstep.

## userVerification policy

| Route          | userVerification |
| -------------- | ---------------- |
| `/sign/start`  | `required`       |
| `/sign/silent` | `discouraged`    |

Server still independently validates the assertion (signature, replay
counter, full policy pipeline). UV `discouraged` is purely a UX hint
to skip the biometric prompt; it does not relax server validation.

## RP ID configuration

This app currently hardcodes `rpId: 'proofline.app'` in `SignStart.tsx`
and `SignSilent.tsx`, matching the server's hardcoded
`expectedOrigin: 'https://proofline.app'`. **The extension config
disagrees** (`rpId: 'proofline.web.app'`) — see PFL-RP-ID-RECONCILE
ticket for the unified fix. Until that lands, the popup must be
deployed to `proofline.app` (or whatever the server agrees on) for
the ceremony to validate end-to-end.

## Run locally

```bash
pnpm --filter @proofline/web-sign dev      # Vite dev server
pnpm --filter @proofline/web-sign build    # production build
pnpm --filter @proofline/web-sign test     # unit tests
```

For end-to-end testing, you need the extension launcher to point at the
dev URL. The extension dev build picks this up from
`apps/extension-chrome/src/shared/config.ts`. A real Playwright
ceremony with virtual authenticators is a future ticket
(PFL-WEBAUTHN-E2E).

## What this app does NOT handle

- WebAuthn registration ceremony (signup/key enrollment) — done in
  `apps/web-admin` finalize step.
- Server-side challenge issuance, policy validation, anchor — all in
  `apps/functions/src/signing/`.
- Real Firebase Auth for `/extension/auth` — stubbed; PFL-AUTH-LOGIN.
- Verify UI for received emails — `apps/web-verify`.
