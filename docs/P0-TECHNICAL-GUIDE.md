# Metra — P0 Released Technical Guide

*Status: P0 (Foundations) shipped + a UI redesign, a multi-tenant SaaS layer, an
RLS defense-in-depth hardening, and a full UI/UX refine — all live in production.
Last updated: 2026-08-11.*

Metra (ميترا) is a bilingual (Arabic `ar-EG` RTL / English `en` LTR), multi-tenant
SaaS for Egyptian interior fit-out contractors — project & cost control from
quotation to final account. This guide documents the **released system**: how it's
built, how tenant isolation works, what ships today, and how it's deployed. For the
history of *how it was built*, see [BUILD-LOG.md](BUILD-LOG.md).

---

## 1. What's live today

A real firm can, entirely inside the product:

- Sign in by **email OTP** (phone-OTP path exists for site engineers).
- Complete a **guided onboarding wizard** (company profile, logo, defaults) that
  creates their organization; the creator becomes **Owner**.
- Land on a **dashboard** with a getting-started activation checklist and honest
  empty states (no fabricated metrics).
- **Invite teammates** by email and assign one of **7 roles**, with a copyable
  invite-link fallback, resend/revoke, role changes, and last-owner protection.
- Manage **org settings** (profile, margin-visibility toggles) and their **account**
  (name, language, light/dark theme).
- **Switch between organizations** they belong to (server-revalidated).
- Do all of the above in **Arabic (RTL)** or **English (LTR)** with a self-hosted
  dual-script type system.

The commercial spine (price book → proposals → contracts → job costing → مستخلص
invoicing) is **P1+** and not yet built; unbuilt modules appear as an honest
"Coming soon" disclosure in the navigation.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript (strict), React 19 |
| Styling | Tailwind CSS (logical properties only), shadcn/ui + Radix primitives |
| Type | IBM Plex Sans + IBM Plex Sans Arabic via `next/font` (self-hosted) |
| i18n | `next-intl` (`ar-EG` default, `en`) |
| Backend | Next.js **server actions** + route handlers (one deployable) |
| Database | Postgres 17 (Supabase), **Row-Level Security on every table** |
| ORM | Drizzle (typed SQL, readable migrations) |
| Auth | Supabase Auth (email OTP; phone OTP path) |
| Files | Supabase Storage (private bucket, signed URLs) |
| PDF | Puppeteer + `@sparticuz/chromium` (serverless) — spike only in P0 |
| Email | Resend (invite emails; Supabase SMTP for auth OTP) |
| Hosting | Vercel (`dub1`/Dublin) + Supabase (`eu-west-1`/Ireland) |
| Theme | `next-themes` (light/dark/system, no-flash) |

**Monorepo:** npm workspaces — `apps/web` (`@metra/web`) and `packages/db`
(`@metra/db`). The brand name lives only in the UI/package scope; **no table,
column, or enum carries a brand name**, so a future rename costs nothing below the
UI.

---

## 3. Architecture

### 3.1 Request → data-access model (the core pattern)

Every business data operation flows through **one sanctioned entrypoint**:
`withOrgContext(ctx, fn)` (`packages/db/src/org-context.ts`). It opens a Postgres
transaction and, before any query:

1. `set_config('app.current_org_id', ctx.orgId, true)`  — transaction-scoped GUC
2. `set_config('app.current_user_id', ctx.userId, true)`
3. `set_config('app.current_user_email', ctx.email, true)` — for invite bootstrap
4. `SET LOCAL ROLE metra_app` — a `NOLOGIN NOINHERIT NOBYPASSRLS` role

RLS policies (below) read those GUCs. Because the app connects as a role that
**cannot bypass RLS** and every table has `FORCE ROW LEVEL SECURITY`, a forgotten
`WHERE` clause in application code **cannot** leak across tenants — the database
refuses it.

`requireOrg()` (`apps/web/src/lib/auth/require-org.ts`) resolves the caller's active
org each request: it reads the verified session (`supabase.auth.getUser()`),
resolves the user's memberships via a SECURITY DEFINER function, honors the
`metra_active_org` cookie **only if it names a real membership**, and redirects to
`/login` or `/onboarding` as needed.

### 3.2 Route groups (`apps/web/src/app/[locale]/`)

- `(auth)/login` — OTP sign-in state machine (email/phone, segmented code input,
  resend countdown, membership-aware post-login routing).
- `onboarding/` — 3-step company-creation wizard (pre-org; no app shell).
- `(app)/` — the authenticated shell (sidebar + top bar), wrapping `dashboard`,
  `team`, `settings`, `settings/account`. The layout resolves org/user once.
- `invite/[token]` — tokenized invite acceptance (explicit "Accept" action).
- `api/pdf/spike` — the Arabic-PDF rendering spike (auth-gated).

---

## 4. Data model

All business tables compose the **org-scoped mixin** (`packages/db/src/schema/org-scoped.ts`):

```
id          uuid pk default gen_random_uuid()
org_id      uuid not null references organizations(id)   -- deferred FK
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
unique (org_id, id)   -- enables composite same-org FKs for the P1 line-item spine
```

**Tables today:** `organizations`, `memberships`, `audit_log`, `files`,
`invitations`. Enums: `member_role` (owner · admin · project_manager ·
site_engineer · accountant · client · viewer) and `invitation_status`
(pending · accepted · revoked · expired).

**Conventions carried for P1:**
- **Bilingual fields** — `bilingual('name')` emits `name_ar` / `name_en` + a DB
  check that at least one is non-empty (whitespace-trimmed). Render via
  `pickLocale()` with an "untranslated" fallback — never an empty cell.
- **Money** — `money()` = `numeric(18,4)`, carried as a **string** (never a JS
  float). Displayed via `formatMoney()` (Western digits, `ج.م`/`EGP`).
- **`unique(org_id, id)`** on every table is the groundwork for the §0 line-item
  spine: `CostItem → ProposalLine → ContractLine → {Task, CostAllocation,
  VariationLine, InvoiceLine}` can all reference the same `contract_line_id`
  composite-safely.

---

## 5. Tenant isolation & security model

This is the crown jewel and has been adversarially tested across multiple rounds.

### 5.1 Row-Level Security (two factors)

Every org-scoped table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and an
`org_isolation` policy requiring **both**:

1. `org_id = current_setting('app.current_org_id')` — the tenant match, and
2. `app_is_current_org_member()` — the **membership second factor** (a SECURITY
   DEFINER helper verifying the session user is actually a member of that org).

So a forged/mis-set context `{org_A, non-member}` reads **0 rows** and cannot
insert/update/delete — the isolation no longer rests on the app always passing a
validated org (PRD §4.2: "do not rely on application-layer filtering alone").

**Bootstrap carve-out:** the two legitimate not-yet-member writes — creating an org
(founding membership) and accepting an invite — are permitted only via
`app_can_bootstrap_membership()`, which is true **only** when the org has zero
members (founding) **or** an `accepted` invitation exists for the caller's own
`app.current_user_email` (accept). `user_id = current_user` appears only in a
`WITH CHECK` clause, never in a `USING` clause, so it cannot re-open a read leak.

### 5.2 SECURITY DEFINER helpers (`packages/db/src/rls/functions.sql`)

`app_current_user_memberships`, `app_current_user_orgs`, `app_invitation_by_token`,
`app_is_current_org_member`, `app_can_bootstrap_membership`, `app_claim_invitation`.
All are `STABLE`/`VOLATILE` as appropriate, `SET search_path = ''`, **granted only to
`metra_app`** and **revoked from `public`/`anon`/`authenticated`/`service_role`** —
verified not reachable via Supabase PostgREST RPC.

### 5.3 Other guarantees

- **Audit** — `audit_log` is append-only, enforced by *withholding* UPDATE/DELETE
  grants (not app logic). Membership/invitation/role/settings changes write
  before/after JSON.
- **Invitations** — tokens are 256-bit random, stored only as SHA-256 hashes;
  lookup via the definer function; every failure returns one generic `declined`
  (no wrong-email/expired oracle); a partial **unique** index is the race arbiter;
  `acceptInvite` is claim-then-insert (single consumption even across two accounts
  sharing an email).
- **Org switching** — the `metra_active_org` cookie is `httpOnly` + `SameSite=Lax`
  + `Secure` (prod), server-set only, and **re-validated against real membership
  every request** — a hand-edited cookie is inert.
- **Owner protection** — the last owner cannot be removed or demoted (guarded under
  a `pg_advisory_xact_lock` so concurrent removals can't drop an org to zero owners).
- **Secrets** — the service-role key and DB password are `server-only` and absent
  from the client bundle; `.env` is gitignored and never committed.

### 5.4 The isolation gate (CI)

`tests/isolation/cross-tenant.test.ts` **discovers every `org_id`-bearing table**
from `information_schema` and asserts each has FORCE RLS + a policy, seeds two orgs
(and a multi-org user), and proves zero cross-tenant rows + forged-context denial +
audit immutability. **A P1 table shipped without protection fails CI.** Currently
**20 tests, all green.**

---

## 6. Bilingual / RTL architecture

- `dir` on `<html>` is driven by locale; **CSS logical properties only**
  (`ms/me/ps/pe/start/end`) — enforced by a custom ESLint rule
  (`metra/no-physical-inline-direction`). The sidebar flips to the right in Arabic
  automatically (flex row, no absolute positioning).
- **Western numerals** (0–9) everywhere, both locales (`Intl` forced to `-u-nu-latn`)
  — Egyptian business/tax documents use them.
- Dates: Gregorian `DD/MM/YYYY`, stored UTC, rendered `Africa/Cairo`.
- The type system loads Arabic-first in RTL, Latin-first in LTR (direction-aware
  `--font-sans`), matching the fonts already embedded in generated PDFs.
- Every user-facing string is in **both** `messages/en.json` and `messages/ar-EG.json`
  with identical key sets (207 keys, parity checked).

---

## 7. Deployment

### 7.1 Topology
- **Vercel** builds `apps/web` (Root Directory = `apps/web`), region `dub1`,
  auto-deploys on push to `main` via GitHub integration.
- **Supabase** project `dsizfubbownuooxpuyii`, region `eu-west-1` (Postgres 17).
- Repo: `github.com/nabilhakeem22/Metra.app`.

### 7.2 Environment variables (set in Vercel + local `.env`)
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` ·
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SERVICE_ROLE_KEY` (server-only) ·
`DATABASE_URL` (session pooler :5432 — migrations) · `DATABASE_POOL_URL`
(transaction pooler :6543, `prepare:false` — runtime) · `RESEND_API_KEY` ·
`RESEND_FROM` · `NEXT_PUBLIC_APP_URL` (⚠️ *should* be set in prod — see backlog) ·
`NEXT_PUBLIC_DEFAULT_LOCALE=ar-EG`.

> **Gotcha:** `NEXT_PUBLIC_*` values are inlined at **build** time; changing an env
> var in Vercel requires a **redeploy**. Empty git commits are de-duplicated by
> Vercel — force a rebuild with a real change or a dashboard "Redeploy". `next dev`
> only loads `apps/web/.env.local`, not the monorepo-root `.env`.

### 7.3 Database migrations & RLS
- Schema migrations: `npm run db:migrate` (Drizzle, `packages/db/migrations/`).
- RLS (roles, policies, SECURITY DEFINER functions): `npm run db:apply-rls` — an
  **idempotent** SQL apply (`functions → roles → policies`). RLS is *not* a Drizzle
  migration because Drizzle doesn't manage roles/policies/functions.
- Seed (two orgs + a multi-org user, for the isolation gate): `npm run db:seed`.

### 7.4 CI (`.github/workflows/ci.yml`)
On every push: `lint` (incl. the RTL rule) → unit tests (`@metra/db` + `@metra/web`)
→ `migrate` → `apply-rls` → `seed` → **the isolation gate**, on a Postgres 17
service container.

### 7.5 Local dev
`npm install` → create `apps/web/.env.local` (copy of root `.env`) →
`npm run dev -w @metra/web`. Full setup and env docs in the root `README.md`.

---

## 8. Known limitations & pre-P1 backlog

From the full code review (see [BUILD-LOG.md](BUILD-LOG.md) §Reviews). None are
tenant-isolation or secret defects — those held.

**Clear before P1 code (architecture):** design the immutability-of-issued-objects
DB pattern (signed contracts / issued invoices) · a thin per-aggregate data-access
layer for cross-stage line-item invariants · composite FKs over the per-row
`enforce_same_org` trigger + an `org_id`/FK index convention · an action-level test
harness.

**Performance (before real load):** the member-identity resolver is serial N+1
(`getOrgMemberIdentities`); each authed page re-does auth work (5 `getUser` + 3
membership lookups) — cache/dedupe with React `cache()`; add `getSessionUser`/DB
`statement_timeout`/`connect_timeout`; fire-and-forget the invite email; add a
`memberships(user_id)` index.

**Before pilots (security):** server-side rate-limit + CAPTCHA on OTP send;
**set `NEXT_PUBLIC_APP_URL` in prod**; add security headers + CSP; input length
caps; gate/rate-limit or remove the PDF spike.

**UX fixes (from the refine):** `isProfileComplete` rejects single-language firms
(permanent onboarding nag); the invite checklist item ticks on *accept* not *send*;
the language switcher is labeled with the current (not destination) language.

**Owner decisions (PRD §10):** PDPL hosting-region ruling (data is in the EU);
verify a Resend **sending domain** so invites deliver to anyone (test sender only
reaches the account owner); rotate the DB password; trademark/domain for
"Metra / ميترا"; validate the مستخلص template against real certificates before P3.

---

## Immutability (P1-prep)

Two mechanisms make records tamper-resistant. Pick per the matrix:

| Need | Mechanism |
|---|---|
| Append-only ledger (never edited, e.g. `audit_log`) | GRANTs — `metra_app` gets `select, insert` only (no `update`/`delete`) |
| Status-locked business row (e.g. invoice/contract/variation frozen once issued/signed) | `enforce_immutable_when()` trigger factory |

Adoption for a status-locked table (`rls/*.sql`, applied by `db:apply-rls`):

```sql
create trigger trg_invoices_immutable
  before update or delete on public.invoices
  for each row
  execute function public.enforce_immutable_when('status','issued','credited,superseded');
-- TG_ARGV: [0] status column, [1] locked statuses (csv),
--          [2] allowed target statuses a locked row may transition to (csv; '' = none).
```

Once a row's status is in the locked set, the trigger:
- rejects `DELETE` with SQLSTATE **`MT100`**;
- rejects any `UPDATE` except a transition to a whitelisted status where only
  `status` + `updated_at` changed (`raise ... MT100` otherwise).

`MT100` is reserved for immutability violations. Rows whose status is not locked
are unrestricted.

## Composite same-org foreign keys (P1-prep)

Prefer `sameOrgRef` / `sameOrgFk` (`packages/db/src/schema/org-ref.ts`) for
child→parent references within an org. The composite FK `(org_id, <name>_id) ->
target(org_id, id)` makes a cross-org reference impossible at the database
(requires the target's universal `unique(org_id, id)`), and ships an
`(org_id, <name>_id)` index. The older `enforce_same_org()` trigger is deprecated
for hot paths (kept only for non-composite / cross-schema targets).
