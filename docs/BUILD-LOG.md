# Metra — Build Log

*How Metra was built: the phases, the multi-agent process, the migrations, and the
issues found and fixed along the way. For the current released architecture, see
[P0-TECHNICAL-GUIDE.md](P0-TECHNICAL-GUIDE.md). Last updated: 2026-08-11.*

---

## How the work was run — the build squad

Metra was built by a four-role autonomous **build squad**, each phase run as:

1. **Architect** — turns a brief into a file-level plan with interface contracts,
   an assumption ledger, and testable acceptance criteria. Never writes code.
2. **Coder** — implements the plan task-by-task, keeping the tree runnable and
   committing in milestones. Reports deviations instead of improvising.
3. **Testers ×3** (functional / security / reliability) — run **in parallel**,
   adversarially, with **no write access**. They break the build; they never fix it.
4. **Product Manager** — consolidates the plan + code + all tester reports into one
   GO / GO-WITH-RISK / NO-GO verdict and a deduplicated fix list.

Findings loop back to the coder; testers re-verify; the PM re-verdicts. This is why
several **critical bugs were caught before they ever shipped** (see below).

Every phase was verified (tsc + build + lint + unit + the isolation gate),
secret-safety-checked, and deployed to Vercel. Nothing was pushed until green.

---

## Phase timeline

### P0 — Foundations *(shipped)*
Multi-tenant scaffold: Next.js 15 + Supabase + Drizzle monorepo; email/phone OTP
auth; org onboarding; **Postgres RLS on every table** keyed to a per-request GUC +
`SET LOCAL ROLE metra_app`; the immutable `audit_log`; file storage; the bilingual
/RTL shell + design system; and the **Arabic-PDF rendering spike** (Puppeteer +
embedded IBM Plex Sans Arabic — de-risked in week 1). Exit gate: a schema-discovering
**two-org cross-tenant isolation test**, green in CI.

**Migrations:** `0000` (organizations, memberships, audit_log, files) + the initial
RLS (`merta_app` role, policies, `enforce_same_org`). *(Role/bucket/scope were
initially "merta"; renamed to "metra" later — see UI Redesign.)*

### UI Redesign *(shipped)*
Replaced the placeholder shell with an app shell (RTL-aware sidebar + top bar,
mobile drawer), a component kit (StatCard, inline-SVG Gauge, segmented OTP input
with resend countdown, EmptyState, Card, PageHeader), honest empty-state dashboard,
and a branded auth flow. Also the **brand correction**: `Merta/مرتا` → **`Metra/ميترا`**
across UI + `@metra/*` scope + `metra_app` role + `metra-files` bucket (DB
identifiers stay brand-free).

### Multi-tenant SaaS uplift *(shipped, 3 slices)*
- **Slice 1 — Activation & UX kit:** 3-step onboarding wizard (+ profile/logo/city
  /tax columns, migration `0004`), getting-started checklist (trace-line motif),
  global kit (toast, confirm-dialog, skeleton, page-header). 
- **Slice 2 — Team & access:** `invitations` table (migrations `0005`/`0006`),
  members page, tokenized invite/accept (hashed tokens via SECURITY DEFINER
  `app_invitation_by_token`), the 7-role matrix, copyable invite-link fallback.
- **Slice 3 — Settings & workspace:** org settings + account pages, the
  server-revalidated **org switcher** (`app_current_user_orgs()` + `metra_active_org`
  cookie).

**Slice 2 is where the squad earned its keep.** The testers found — and the fixes
were then independently re-verified:
- 🔴 **Critical: last-owner race** — two concurrent owner removals both passed the
  "≥1 owner" check → an org with **zero owners** (unrecoverable). Fixed with a
  `pg_advisory_xact_lock` per org; re-verified 10/10 trials safe.
- 🟠 **High: duplicate pending invites** — the index wasn't UNIQUE → concurrent
  invites minted two tokens for one seat. Fixed (partial **unique** index).
- 🟠 **High: dead invite links** — `NEXT_PUBLIC_APP_URL` unset → relative links.
  Fixed (absolute origin from request headers).
- 🟡 **Medium: one invite → two memberships** when two accounts share an email.
  Fixed (claim-then-insert single consumption).

### RLS defense-in-depth hardening *(shipped)*
A security review noted the RLS gated only on the `app.current_org_id` GUC, not on
*membership* — so isolation rested on the app always passing a validated org. Added
a **membership second factor** (`app_is_current_org_member()`) to every policy, with
a bootstrap carve-out (`app_can_bootstrap_membership()` — zero-member org or
email-matched accepted invite) gated on a new server-derived `app.current_user_email`
GUC, and routed the invite claim through `app_claim_invitation`. The naive
"allow your own membership" carve-out would itself have been a self-join backdoor;
the design closes it. Security tester **SURVIVED** — every forged-context and
self-join attempt rejected; isolation gate grew to **20 tests**.

### UI/UX refine campaign *(shipped)*
An audit-first evaluation (design review + a mechanical detector, run as two
isolated agents) scored the UI **26/40 design · 17/20 technical** — verdict:
*"well-engineered but a category-interchangeable template; no typography identity."*
Recommendation: **refine, not redesign.** The campaign shipped an authored
"blueprint-ledger" world:
- **Type:** self-hosted IBM Plex Sans + IBM Plex Sans Arabic (`next/font`),
  direction-aware, tabular figures — replacing the system-ui fallback.
- **Palette:** warm-paper canvas / deep blueprint-teal ink / copper trace accent,
  plus a real dark theme — retiring the shadcn-default blue (and fixing an
  amber-on-white WCAG contrast fail).
- **Identity:** a drawn Metra mark + the copper trace motif; browser-surface theming
  (selection, caret, scrollbar).
- **Dead-app fixes:** membership-aware post-login routing, unbuilt nav collapsed
  under one "Coming soon" disclosure, the dead search box removed, a real dashboard
  CTA.
- **Hardening:** localized role labels, `aria-live` errors, reduced-motion
  consistency, a light/dark/system toggle, 44px touch targets.

The impeccable **detector went 9 → 0** anti-patterns on the live pages; contrast now
passes (primary 9.49:1, copper 6.52:1); the full test gate stayed green.

---

## Migrations ledger

| # | Name | What |
|---|---|---|
| 0000 | initial | organizations, memberships, audit_log, files + org-scoped mixin |
| 0001 | bilingual check | `_ar/_en` present-check refinement |
| 0002 | (rework of 0001) | whitespace-safe present-check |
| 0003 | bucket default | `files.bucket` default → `metra-files` (brand rename) |
| 0004 | org profile | organizations: `logo_file_id`, `city`, `tax_registration_number`, `hide_margin_from_pm`, `restrict_firm_dashboard` |
| 0005 | invitations | `invitation_status` enum + `invitations` table |
| 0006 | pending-invite unique | partial **unique** index on `(org_id,email) where status='pending'` |

RLS objects (roles, policies, SECURITY DEFINER functions) live in
`packages/db/src/rls/*.sql` and are applied idempotently by `db:apply-rls` (they are
not Drizzle migrations). The schema import cycle introduced by the `0004` logo FK was
fixed by making `org-scoped.ts` a leaf module (deferred FK callbacks).

---

## Full pre-P1 code review (2026-08-11)

Four reviewers across the whole codebase, then consolidated. **Security SURVIVED**
(no High), **Architecture READY** to build the P1 line-item spine on, Correctness +
Reliability found fixable issues. **Held:** tenant isolation 20/20, no secret leak,
all authz server-side, atomicity/idempotency, no context-bleed, i18n 207-parity.

Prioritized backlog (also in [P0-TECHNICAL-GUIDE.md](P0-TECHNICAL-GUIDE.md) §8):

- **Before P1 code:** immutability-of-issued-objects DB pattern · per-aggregate data
  layer · composite FKs + index convention · action-level test harness.
- **Performance:** N+1 identity resolver · redundant per-page auth work (add React
  `cache()`) · request/DB timeouts · fire-and-forget invite email · `memberships(user_id)` index.
- **Before pilots (security):** OTP-send rate-limit + CAPTCHA · set `NEXT_PUBLIC_APP_URL`
  in prod · security headers + CSP · input length caps · the PDF-spike DoS.
- **UX (from the refine):** `isProfileComplete` rejects single-language firms · the
  invite checklist ticks on accept not send · the locale switch is mis-labeled.

*Process note:* one reviewer ran heavier-than-intended load benchmarks against the
staging DB (rolled back; data verified untouched). Reviewer DB access is now
row-capped.

---

## Owner action items (not code)

- **Verify a Resend sending domain** so invites deliver to anyone (the test sender
  only reaches the account owner).
- **Rotate the DB password** (currently low-entropy).
- **PDPL hosting-region decision** (data is in the EU, not Egypt; the region can't
  change without re-provisioning).
- **Trademark / domain** clearance for "Metra / ميترا" (`metra.app`).
- Validate the **مستخلص** template against real certificates before P3.

---

## What's next — P1

The commercial spine, built on the composite-key + RLS foundation:
**price book → proposals → contracts (+ variation orders) → scheduling → job costing
(cost entries, custody/عهدة, the job-cost sheet) → مستخلص invoicing.** The
architecture review's "clear before P1 code" list should be actioned first — they're
the next layer, not rework.
