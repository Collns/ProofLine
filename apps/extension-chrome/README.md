# ProofLine Chrome Extension

Manifest v3 extension that injects a "Sign with ProofLine" button into
the Gmail compose toolbar.

## Build

```sh
pnpm --filter @proofline/extension-chrome build
```

Output: `apps/extension-chrome/dist/` containing `manifest.json`,
`content.js`, `background.js`, `popup.js`, `popup.html`, and three icons.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select `apps/extension-chrome/dist/`
5. Open `mail.google.com`
6. Compose a new email
7. **Sign with ProofLine** button should appear in the toolbar

## Verify it's working

- `chrome://extensions` → ProofLine card → "Service worker (active)"
- Open Gmail → compose → see button
- Click button → check service worker console:
  `chrome://extensions` → ProofLine → click the **Service worker** link
- Look for: `[ProofLine background] message received: { type: 'SIGN_BUTTON_CLICKED', composeId: ... }`

## Surface architecture

```
content script (mail.google.com)        background service worker
  ├─ MutationObserver → sweep            ├─ chrome.runtime.onMessage
  ├─ gmail-detector  (DOM queries)       └─ handleMessage → ack
  └─ inject-toolbar  (button + click)
                         ↓ chrome.runtime.sendMessage
                         ↓ ack ↑

popup (chrome.action)
  └─ shows version + stub Connect button
```

## Troubleshooting

- **Button missing after a Gmail UI update**: Gmail's DOM may have
  changed. The selector chain in
  [src/content/shared.ts](src/content/shared.ts) (`TOOLBAR_SELECTORS`)
  may need updating. Open DevTools on the Gmail compose, find the
  toolbar element, add the new selector to the front of the array,
  rebuild, reload.
- **Toolbar not found notice appears**: every fallback selector missed.
  Same fix as above. The compose dialog gets `data-proofline-toolbar-not-found="true"`
  for easy DevTools selection.
- **Service worker shows "inactive"**: Chrome de-spawns MV3 SWs after
  ~30s of idle. Sending a message wakes it up — that's expected.
- **Icons are flat blue squares**: placeholders for now. Real assets
  ship in a later slice.

## Stub disclaimers

The button click does **not** sign anything yet. It posts a
`SIGN_BUTTON_CLICKED` message to the service worker, which logs and
acks. Real signing wires in PFL-044/047. The popup's Connect button
shows an alert and is also a stub — full WebAuthn onboarding lands later.

## Permissions

Declared in [manifest.json](manifest.json):

- `storage` — future signed-session caching
- `scripting` — for future programmatic re-injection on Gmail SPA nav
- `activeTab` — popup interactions with the active tab
- Host: `mail.google.com` (where we inject) and
  `app.proofline.web.app` (future API origin — see
  [src/shared/config.ts](src/shared/config.ts))
