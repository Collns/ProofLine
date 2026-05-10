# Design Prototype — REFERENCE ONLY

This is the Gemini-generated design template for all ProofLine 
v3.2 surfaces. It is the **source of truth for visual design**: 
colors, spacing, typography, component composition, copy, motion, 
layouts.

## What's in here

Every PRD §8 surface as a sibling React component:
- Marketing landing, public verify, onboarding wizard
- Admin console, sessions tab, signing policy
- Popup ceremonies (session start, silent sign, cosign)
- Gmail/Outlook compose mocks (the v3.2 extension surface)
- Gmail/Outlook inbound badge mocks
- Inline HTML email banner contexts

Switch between them with the floating "+" hub in the bottom-right.

## How to run

    pnpm --filter @proofline/design-prototype dev
    # → http://localhost:3100

## How to use it

When building any production surface in `apps/web-admin`, 
`apps/web-verify`, `apps/web-counterparty`, 
`apps/extension-chrome`, or `packages/ui` — REFERENCE THIS APP 
for the design.

Match the visuals exactly:
- Colors → `src/lib/tokens.ts`
- Component composition → `src/components/ProofComponents.tsx`
- Per-surface layouts → `src/surfaces/<Surface>.tsx`

Adapt to the production architecture (Manifest v3 extension, 
Firebase Functions, real WebAuthn ceremonies, etc.). The 
prototype's components are React-only with hardcoded demo data; 
production versions wire to real APIs.

## Hard rule: DO NOT IMPORT FROM THIS APP

Nothing in `apps/*` (other than this app itself) or `packages/*` 
may import from `@proofline/design-prototype`. It exists to be 
looked at, not consumed as a library.

Lift designs into the right production location when you build 
each surface. For shared components (VerifyBadge, SignerChip, 
AnchorReceipt, etc.), the destination is `packages/ui`.

## Demo backup

If a production surface breaks during the live demo, fall back 
to this prototype to show the design. Narrate: "this is the 
production design we're shipping; the live build renders it 
from real signed envelopes."
