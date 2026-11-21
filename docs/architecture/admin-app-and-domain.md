# Admin app rework + custom domain

**Status:** plan / research. Plan only — nothing here is built yet.
**Scope:** (1) rework web-admin into one app with server-decided, role-based views; (2) remove the demo landing from production; (3) move all surfaces to a custom domain without breaking signing, passkeys, or historical verify links.
**Related tickets:** PFL-140–144 (platform admin), PFL-177 (pending_review), PFL-131 (audit viewer), PFL-041 (policy UI — superseded by PFL-188), PFL-178 (demo landing / real `/`), PFL-168 (fixtures/skip), PFL-179 (single config for hosts/RP/links).

---

## 1. Current state (verified)

### web-admin
- **Flat router** (`App.tsx`): `/` → `/demo` (DemoHub), `/login`, `/onboarding`, `/dashboard`, `/team`, `/settings`, `/invitations[/new|/:id]`, `*`.
- **`ProtectedRoute` gates auth + company presence only — never role.** Role gating is done ad-hoc inside each page, client-side.
- **Role is not in `AuthContext`.** Context resolves `companyId` by a client-side Firestore read of `users/{uid}`; it exposes no `role`. Each page (e.g. `SettingsPage`, `DashboardHome`) *re-fetches the whole user list and finds its own row* to learn its role. Server-side it **is** enforced: `functions/src/auth/admin-auth.middleware.ts` requires `status==="active"` and `role ∈ {owner, manager}`; an owner may target another company via `?cid=` only when `companies/{cid}.ownerUserId` matches (owner-of-that-company, **not** cross-tenant staff).
- **Roles:** `owner | manager | employee` (`packages/types/.../role-credential.ts`). **No `platform_admin` / staff role exists anywhere.**
- **Nav** (`AppShell.tsx`) renders exactly two links: Dashboard, Invitations. **`/settings` (the signing-policy page) and `/team` are reachable only by typing the URL** — the policy page is effectively missing from the UI.
- **Pages that exist:** DemoHub, LoginPage, OnboardingWizard (+ 9 steps), DashboardHome (users/devices/sessions/profile/network-coverage; a stale `DashboardHome.old.tsx` lingers), TeamPage, SettingsPage (unsigned-email policy), invitations list/new/detail, NotFound.
- **Gaps:** audit log viewer (server `GET /v1/admin/audit` exists, **no UI**); a dedicated member/self view (employees get 403 from the admin API); company-profile editing (read-only today); platform-admin everything.

### Demo landing
- Public root `/` **unconditionally** redirects to `/demo` → `DemoHub`, a launchpad with `T+0s` beat labels and links to external demo apps + the Firebase console. **Not behind any env flag** — it ships in the production build. This is the landing every unauthenticated visitor hits.

### Domain coupling (every place a host/RP is wired)
| # | Concern | Where | Env-driven? |
|---|---|---|---|
| 1 | Firebase Hosting sites | `.firebaserc` targets `proofline-admin/sign/verify/counterparty`; `firebase.json` hosting[] | config |
| 2 | Firebase Auth `authDomain` + authorized domains | `web-admin/src/lib/firebase.ts`, `web-sign/src/lib/firebase.ts` (`<project>.firebaseapp.com`) + Google/email-link authorized domains | partial |
| 3 | **WebAuthn RP ID = `proofline-sign.web.app`** | **hardcoded string in ~15 files**: functions `sign/sign-finalize/sign-silent/signing.helpers/register-credential`, `cosign-finalize` (`COSIGN_RP_ID`), bilateral (`BILATERAL_RP_ID`/`BILATERAL_ORIGINS`); web-sign `webauthn-register/SignStart/SignSilent/CosignApprove/CountersignApprove`; web-counterparty `webauthn-bridge`. `webauthn/verify-assertion.ts` itself is parameterized (`rpId`, `origins`) — the literals live in its callers. | **no — hardcoded** |
| 4 | Extension hosts | `manifest.json` `host_permissions` + `externally_connectable` (`proofline-sign.web.app`, `…cloudfunctions.net`); `src/shared/config.ts` `signOrigin/rpId/verifyBaseUrl/apiOrigin` via `EXT_*` env | env (manifest static) |
| 5 | CORS allowlist | `functions/src/index.ts` `ALLOWED_ORIGINS` (4 `web.app` + 4 `firebaseapp.com`) | hardcoded list |
| 6 | Email link hosts | `functions/src/index.ts` `SIGN_APP_URL`/`COUNTERPARTY_PORTAL_URL`/`ADMIN_APP_URL` (env, `web.app` defaults); `cosign-request` `DEFAULT_SIGN_APP_BASE_URL`, `cosign-refresh` `DEFAULT_PORTAL_BASE_URL` (hardcoded defaults) | partial |
| 7 | Verify banner links | `packages/email/src/banner.ts` `VERIFY_BASE_URL` (hardcoded); extension `background/index.ts` `verifyUrl` (hardcoded); extension `config.ts` `verifyBaseUrl` (env) | partial |
| 8 | Resend sending domain | `RESEND_FROM_DOMAIN` env + SPF/DKIM/DMARC DNS | env + DNS |

PFL-179 already exists to centralize #3/#4/#6/#7 into per-app config — it is the prerequisite for the domain move.

---

## 2. Target: one app, role-based views (server-decided)

### Foundation (must come first)
Resolve identity **once, on the server**, and carry it in context:
- Add `GET /v1/me` → `{ userId, companyId, role, platformAdmin }`, sourced from the user doc + a server check; ideally also mint a Firebase **custom claim** (`role`, `platformAdmin`) so the client can gate without a Firestore read and the server can trust the token.
- Put `role` + `platformAdmin` + `companyId` in `AuthContext`; delete the per-page "fetch user list to find my own role" pattern and the client-side company read.
- Add a **`RoleGuard`** wrapper (route-level) on top of `ProtectedRoute`. **The client gate is cosmetic; every endpoint keeps enforcing server-side** (the rule the task restates: role is chosen by the server, never trusted from the client).
- **`platform_admin` is a separate global capability, not a company role.** Model it as a custom claim / `platform_admins` collection checked in a new middleware — do **not** add it to the per-company `owner|manager|employee` enum (a staff member is cross-tenant; company roles are per-company).

### The three views
**Platform admin (ProofLine staff)** — greenfield; maps to existing todo tickets:
- Companies list + search → **PFL-141**
- Onboarding review queue (stub-KYB/IDV → `pending_review`) → **PFL-142**, fed by **PFL-177**
- Read-only step-into-company with audited "take action" → **PFL-143**
- Suspend / ban company or user → **PFL-144**
- Platform metrics → **unticketed** (propose new; the "PFL-145" the task assumed doesn't exist)
- Role + routes + middleware → **PFL-140**

**Company admin (owner/manager)** — mostly exists, needs nav + two gaps:
- Users/roles, devices, sessions → exist on DashboardHome
- Signing policy (block/warn/allow, allowUnsignedOverride, unsigned footer) → SettingsPage exists but **must be put in the nav**
- Audit log incl. unsigned overrides → **PFL-131** (server endpoint exists; build the UI)
- Invitations/counterparties → exist
- Company profile + verification status → read-only today; add an edit page
- Pending-review banner when stub-verified → ties to **PFL-177**

**Member (employee)** — greenfield, needs backend:
- My devices/passkeys, my sessions, my signed/unsigned mail, install/connect extension
- **Requires new member-scoped endpoints** — today the admin GET API is owner/manager-only and returns 403 to employees, so a member view cannot reuse it.

**Cross-cutting:** a real nav per role (surface `/settings`, `/team`, audit, member pages); empty states on every list; a **role switcher only for users who actually hold more than one** (e.g. a staff member who is also a company owner, or a user in multiple companies) — hidden for the common single-role case.

---

## 3. Remove the demo landing from production

- **`/` must render login (or a neutral landing), not DemoHub.** This is **PFL-178**'s scope ("real `/` routes: login / dashboard / neutral landing; move DemoHub out"), **not PFL-168** — PFL-168 is specifically the `SkipDemoButton` + `?fixture=` shortcuts. So: **PFL-168 does *not* cover the landing; PFL-178 does.** Both are needed for a clean prod build (landing + fixtures), and `DemoHub.tsx` + its external demo links + the stale `DashboardHome.old.tsx` should be deleted or moved behind `import.meta.env.DEV`.
- Acceptance to add: a prod build has no route linking to demo/fixture content (grep the bundle in CI — already PFL-168's acceptance).

---

## 4. Custom domain move — ordered so nothing breaks

Assume the apex is `example.com` with `app.`, `sign.`, `verify.`, `counterparty.` subdomains.

### The two hazards
1. **Passkeys are bound to the RP ID `proofline-sign.web.app`. Changing the RP ID invalidates every existing passkey** — there is no server-side way to verify an old credential against a new RP ID. Re-enrollment is unavoidable. *Mitigation:* set the new RP ID to the **apex/registrable domain** (`example.com`), not `sign.example.com`, so one credential works across `app.`/`sign.`/`counterparty.` subdomains (today's per-host RP is a limitation worth shedding). Store `rpId` **per credential** and have `verify-assertion` pick it, so old (`proofline-sign.web.app`) and new (`example.com`) credentials verify side-by-side during a transition window instead of a hard cutover.
2. **Verify links in already-sent emails point at `proofline-verify.web.app` forever.** The old host must keep serving (or 301 → `verify.example.com`) indefinitely; never retire it.

### Step order
1. **Buy the domain; get DNS control.**
2. **PFL-179 — centralize hosts/RP/links into per-app config** (prerequisite; turns the move into config edits, not a 15-file literal hunt).
3. **Attach custom domains** to the four Hosting targets. `.web.app` keeps serving in parallel — no break.
4. **Firebase Auth:** add `app.example.com` (and any auth origin) to **authorized domains**; update Google OAuth redirect URIs; decide whether to move `authDomain` to `auth.example.com`.
5. **Resend:** add the new sending domain, publish SPF/DKIM/DMARC, verify in Resend; keep the old `RESEND_FROM_DOMAIN` until the new one is verified and warmed.
6. **WebAuthn RP migration (the hard one):** make RP ID/origins config-driven; store `rpId` per credential; dual-RP verification; serve web-sign at `sign.example.com` **and** keep `proofline-sign.web.app` alive during transition; ship a "re-enroll this device" flow + user comms. New credentials enroll under the apex RP; old passkeys keep working until their users re-enroll.
7. **New extension build** pointing `EXT_*` at the new hosts + new RP; update `host_permissions` + `externally_connectable`; submit to the Chrome Web Store and wait for review + rollout. The extension must understand the new hosts **before** server links switch.
8. **Flip server env:** `SIGN_APP_URL`/`COUNTERPARTY_PORTAL_URL`/`ADMIN_APP_URL`, `VERIFY_BASE_URL`, `RESEND_FROM_DOMAIN`; add the four new origins to `ALLOWED_ORIGINS` (keep the old ones during transition). Fix the hardcoded `DEFAULT_*_URL` defaults.
9. **Long tail:** keep `proofline-verify.web.app` (and ideally all old hosts) serving or 301-redirecting for historical links; retire `.web.app` only after the transition window and passkey re-enrollment are well past.

> Why this order: hosting + auth + Resend (3–5) are additive and break nothing; the RP migration (6) is the only user-facing break and is gated behind config + dual-RP so it's gradual; the extension (7) must ship before the server starts emitting new-host links (8); old hosts never hard-retire (9).

---

## 5. Proposed Phase 12 tasks — "Phase 12 — Admin app + domain"

Owners: **A = backend**, **B = frontend** (matching existing tag conventions). Proposed only — **not created**; shown for approval. Several map onto existing tickets (reuse, don't duplicate).

### Admin app rework
| ID | Owner | Task | Depends on |
|---|---|---|---|
| PFL-196 | A | Server-resolved identity: `GET /v1/me` + role/platformAdmin **custom claims**; put role+companyId in `AuthContext`; drop per-page role/company Firestore reads | — |
| PFL-197 | B | Role-aware routing + nav: `RoleGuard`, per-role nav, surface `/settings` + `/team`, empty states, multi-role switcher | PFL-196 |
| PFL-199 | A | Member-scoped API: self endpoints (my devices, my sessions, my signed/unsigned mail) — admin API is owner/manager-only today | PFL-196 |
| PFL-198 | B | Member view UI (devices/passkeys, sessions, my mail, install/connect extension) | PFL-199, PFL-197 |
| PFL-131 | B | *(existing)* Company-admin audit log viewer on `GET /v1/admin/audit`, incl. unsigned overrides | PFL-197 |
| PFL-200 | B | Company profile **edit** page + verification/pending-review status banner | PFL-197, PFL-177 |
| PFL-140 | A | *(existing)* `platform_admin` role + guarded `/platform/*` routes + middleware | PFL-196 |
| PFL-141 | B | *(existing)* Platform: companies list + search | PFL-140 |
| PFL-142 | A/B | *(existing)* Platform: onboarding review queue (stub → `pending_review`) | PFL-140, PFL-177 |
| PFL-143 | B | *(existing)* Platform: read-only step-into-company + audited "take action" | PFL-140 |
| PFL-144 | A | *(existing)* Platform: suspend/ban companies + users | PFL-140 |
| PFL-201 | A/B | Platform metrics dashboard (companies, signings, coverage) — the unticketed "metrics" piece | PFL-140, PFL-141 |

### Demo removal
| ID | Owner | Task | Depends on |
|---|---|---|---|
| PFL-178 | B | *(existing)* Real `/` routes (login/dashboard/neutral); remove DemoHub + demo links from prod; delete `DashboardHome.old.tsx` | — |
| PFL-168 | B | *(existing)* Remove SkipDemoButton + `?fixture=` shortcuts from prod; dev-only seed | — |

### Custom domain
| ID | Owner | Task | Depends on |
|---|---|---|---|
| PFL-179 | B | *(existing)* Centralize hosts / RP ID / links into per-app config (prerequisite) | — |
| PFL-202 | A/B | Attach custom domains to the 4 Hosting targets; Firebase Auth authorized domains + OAuth redirects; add new origins to CORS | PFL-179 |
| PFL-203 | A | Resend: new sending domain + SPF/DKIM/DMARC; keep old until verified | — |
| PFL-204 | A | **WebAuthn RP migration**: config-driven RP (apex domain), per-credential `rpId`, dual-RP verification, re-enrollment flow + comms | PFL-179 |
| PFL-205 | B | New extension build for the custom domain (`EXT_*`, `host_permissions`, `externally_connectable`) + CWS submission | PFL-204 |
| PFL-206 | A | Flip server link/env to new hosts; keep legacy hosts (esp. `proofline-verify`) serving/301 for historical verify links | PFL-202, PFL-205 |

### Suggested overall order
1. **PFL-196 → PFL-197** (identity + nav) — unblocks every other admin-app task and immediately fixes the orphaned settings page.
2. **PFL-178 + PFL-168** (demo removal) — small, independent, and needed before any real public launch.
3. **PFL-199 → PFL-198** (member view) and **PFL-131 / PFL-200** (admin gaps) in parallel.
4. **PFL-140 → 141/142/143/144 → 201** (platform admin) — larger, gated on PFL-196.
5. Domain, in the §4 order: **PFL-179 → PFL-202 + PFL-203 → PFL-204 → PFL-205 → PFL-206.** The RP migration (PFL-204) is the critical-path, user-facing one; everything before it is non-breaking.

New net tasks to create: **PFL-196, PFL-197, PFL-198, PFL-199, PFL-200, PFL-201, PFL-202, PFL-203, PFL-204, PFL-205, PFL-206** (11). The rest already exist and would be moved into / linked from the Phase 12 group.
