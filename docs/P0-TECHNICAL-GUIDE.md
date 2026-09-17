# Metra — Released Technical Guide

*Status: P0 (Foundations) plus the P1 commercial spine (price book → proposals →
contracts → BOQ → variation orders), the design-engagement machine with its
client delivery portal, and a read-only Public API v1 — all live in production.
The app moved off its original host onto **Cloudflare Workers** (OpenNext) in
August 2026; every deployment fact in §7 describes that system.
Last updated: 2026-09-17.*

Metra (ميترا) is a bilingual (Arabic `ar-EG` RTL / English `en` LTR), multi-tenant
SaaS for Egyptian interior fit-out contractors — project & cost control from
quotation to final account. This guide documents the **released system**: how it's
built, how tenant isolation works, what ships today, and how it's deployed. For the
history of *how it was built*, see [BUILD-LOG.md](BUILD-LOG.md).

---

## 1. What's live today

A real firm can, entirely inside the product:

**Foundations**

- Sign in by **email OTP** (phone-OTP path exists for site engineers).
- Complete a **guided onboarding wizard** (company profile, logo, defaults) that
  creates their organization; the creator becomes **Owner**.
- Land on a **dashboard** with a getting-started activation checklist, honest
  empty states (no fabricated metrics) and trend cards.
- **Invite teammates** by email and assign one of **7 roles**, with a copyable
  invite-link fallback, resend/revoke, role changes, and last-owner protection.
- Manage **org settings** (profile, margin-visibility toggles) and their **account**
  (name, language, light/dark theme).
- **Switch between organizations** they belong to (server-revalidated).
- Do all of the above in **Arabic (RTL)** or **English (LTR)** with a self-hosted
  dual-script type system.

**The commercial spine**

- Keep a **price book** (sections, cost items, bulk price changes) and a **client
  book** (clients, contacts, activities).
- Run **projects** with configurable project types and stage templates
  (start-from-any-phase; no forced linear order).
- Build, send and track **proposals**, with a PDF render and a public
  accept/reject link at `/p/[token]`.
- Convert an accepted proposal into a **contract**, acknowledge it at `/c/[token]`,
  and raise **variation orders** decided at `/v/[token]`.
- Import and cost a **BOQ** (bill of quantities) from a spreadsheet, edit it in
  place while it is a draft, and issue it.

**The design-engagement machine**

- Drive a design engagement through its states (concept, revisions, renders,
  build-cost range, milestones, payments) as an explicit state machine with
  atomic admission gates.
- Share a **client delivery portal** at `/d/[token]` — documents, comments,
  build-cost acknowledgement, payment claims — where the token is the only
  credential and every read goes through a SECURITY DEFINER function that omits
  every cost/margin column.
- Receive **notifications** and hourly **automations** (07:00 Cairo digest, stage
  reminders, proposal expiry) driven by the separate `metra-cron` Worker.

**Integration surface**

- A read-only **Public API v1** (`/api/v1/{clients,cost-items,projects,proposals}`)
  authenticated by hashed API keys and rate-limited at the edge.

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
| Files | Supabase Storage (private `metra-files` bucket, signed URLs) |
| PDF | `@cloudflare/puppeteer` on the Worker's **`BROWSER`** binding (Cloudflare Browser Rendering), embedded Arabic fonts |
| Email | Resend (invites, proposal-sent, and the automation digest / follow-up / stage-reminder mails; Supabase SMTP for auth OTP) |
| Hosting | **Cloudflare Workers** (`metra-web`, OpenNext) + Supabase Postgres/Storage (`eu-west-1`/Ireland) reached through the **Hyperdrive** binding |
| Rate limiting | Workers Rate Limiting bindings (`API_RATE_LIMITER`, `API_PREAUTH_RATE_LIMITER`) — see [API.md](API.md) |
| Theme | `next-themes` (light/dark/system, no-flash) |

**Monorepo:** npm workspaces — `apps/web` (`@metra/web`) and `packages/db`
(`@metra/db`). `workers/cron` is a **separate** wrangler project, deliberately
outside the workspace globs. The brand name lives only in the UI/package scope;
**no table, column, or enum carries a brand name**, so a future rename costs
nothing below the UI.

---

## 3. Architecture

### 3.1 Request → data-access model (the core pattern)

Every business data operation flows through **one sanctioned entrypoint**:
`withOrgContext(ctx, fn)` (`packages/db/src/org-context.ts`). It opens a Postgres
transaction and, before any query:

1. `set_config('app.current_org_id', ctx.orgId, true)`  — transaction-scoped GUC
2. `set_config('app.current_user_id', ctx.userId, true)`
3. `set_config('app.current_user_email', ctx.email, true)` — for invite bootstrap
4. `set_config('role', 'metra_app', true)` — a `NOLOGIN NOINHERIT NOBYPASSRLS` role

The same transaction is **bounded** by three more transaction-scoped settings,
because `metra_app` is reached by a role switch and a role's `rolconfig` defaults
do not apply to one: `lock_timeout = 5s`, `statement_timeout = 20s`,
`idle_in_transaction_session_timeout = 30s`. A writer that cannot take its lock
fails instead of queueing behind an abandoned transaction, and an abandoned
transaction is reaped by the server rather than held until the socket closes.

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
  `price-book`, `clients`, `projects`, `proposals`, `contracts`, `boq`,
  `engagements`, `notifications`, `team`, `settings`. The layout resolves
  org/user once.
- `invite/[token]` — tokenized invite acceptance (explicit "Accept" action).
- **The four public token surfaces**, all outside the app shell and all
  unauthenticated by design — the token IS the credential:
  `p/[token]` (proposal accept/reject) · `c/[token]` (contract acknowledgement) ·
  `v/[token]` (variation decision) · `d/[token]` (the client delivery portal).
  Every one of them reads through a SECURITY DEFINER function that omits cost and
  margin columns; an invalid token renders the same page as an expired one.

### 3.3 Route handlers (`apps/web/src/app/api/`)

- `pdf/proposals/[id]`, `pdf/contract/[id]`, `pdf/boq/[id]` — server-rendered PDFs
  on the `BROWSER` binding. Auth-gated; at the renderer's concurrency cap they
  return a retryable **503 + `retry-after: 5`**, not a 500.
- `v1/{clients,cost-items,projects,proposals}` — the read-only Public API, keyed
  by a hashed API key ([API.md](API.md)).
- `cron/automations` — the hourly automation tick. Bearer-authenticated with
  `CRON_SECRET`; called by the separate `metra-cron` Worker, never by a browser.

---

## 4. Data model

All business tables compose the **org-scoped mixin** (`packages/db/src/schema/org-scoped.ts`):

```
id          uuid pk default gen_random_uuid()
org_id      uuid not null references organizations(id)   -- deferred FK
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
unique (org_id, id)   -- enables composite same-org FKs for the line-item spine
```

**Tables today: 46, across 22 enums** (`packages/db/src/schema/`, one file per
table). They group as: the tenancy core (`accounts`, `organizations`,
`memberships`, `invitations`, `audit_log`, `files`, `workspace_entitlements`); the
catalogue (`sections`, `cost_items`, `price_changes`, `price_change_lines`,
`clients`, `client_contacts`, `activities`, `projects`, `project_types`,
`stage_templates`, `project_stages`); the commercial spine (`proposals`, `contracts`, `boqs`,
`variation_orders` and their section/line/event children); the design-engagement
machine (`design_engagements`, `engagement_events`, `engagement_transitions`,
`engagement_milestones`, `engagement_artifacts`, `engagement_change_orders`,
`engagement_document_comments`, `payment_events`, `client_payment_claims`); and
the platform layer (`notifications`, `automation_settings`, `automation_run_log`,
`api_keys`, `document_categories`).

**Conventions:**
- **Bilingual fields** — `bilingual('name')` emits `name_ar` / `name_en` + a DB
  check that at least one is non-empty (whitespace-trimmed). Render via
  `pickLocale()` with an "untranslated" fallback — never an empty cell.
- **Money** — `money()` = `numeric(18,4)`, carried as a **string** (never a JS
  float). Piastre-exact BigInt arithmetic, rounded half-up. Displayed via
  `formatMoney()` (Western digits, `ج.م`/`EGP`).
- **`unique(org_id, id)`** on every table is what makes the line-item spine
  composite-safe: `CostItem → ProposalLine → ContractLine → {BoqLine,
  VariationLine}` all reference their parent *within the same org*, enforced by
  the database rather than by a `WHERE`.

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

Two families, all `SET search_path = ''`, all **granted only to `metra_app`** and
**revoked from `public`/`anon`/`authenticated`/`service_role`** — verified not
reachable via Supabase PostgREST RPC.

- **Org context / bootstrap:** `app_current_user_memberships`,
  `app_current_user_orgs`, `app_invitation_by_token`, `app_is_current_org_member`,
  `app_can_bootstrap_membership`, `app_claim_invitation`, `app_bootstrap_account`.
- **The public token surfaces** — one function per verb, each taking the raw token
  and resolving it by SHA-256 hash: `app_proposal_by_token` /
  `app_proposal_respond_by_token`, `app_contract_by_token` /
  `app_contract_ack_by_token`, `app_variation_by_token` /
  `app_variation_respond_by_token`, `app_delivery_by_token` /
  `app_delivery_respond_by_token` / `app_delivery_claim_payment_by_token` /
  `app_delivery_document_by_token` / `app_delivery_document_comments_by_token` /
  `app_delivery_comment_by_token`, plus `app_document_access` and
  `app_engagement_payments_settled`. **These are the functions that must never
  return a cost or margin column**, and they are the reason the portals can be
  unauthenticated at all.

- **The Public API:** `app_api_key_by_hash` and `app_touch_api_key`, which resolve
  and stamp an API key without the caller needing an org context first.

Alongside them, the same file holds the trigger functions that keep a child row
editable only while its parent is a draft (`enforce_proposal_child_draft`,
`enforce_contract_child_draft`, `enforce_variation_child_draft`) and
`enforce_same_org`.

### 5.3 Other guarantees

- **Audit** — `audit_log` is append-only, enforced by *withholding* UPDATE/DELETE
  grants (not app logic). Membership/invitation/role/settings changes write
  before/after JSON.
- **Invitations** — tokens are 256-bit random, stored only as SHA-256 hashes;
  lookup via the definer function; every failure returns one generic `declined`
  (no wrong-email/expired oracle); a partial **unique** index is the race arbiter;
  `acceptInvite` is claim-then-insert (single consumption even across two accounts
  sharing an email). The share tokens behind `/p`, `/c`, `/v` and `/d` follow the
  same rule: 256-bit, hashed at rest, never logged.
- **Org switching** — the `metra_active_org` cookie is `httpOnly` + `SameSite=Lax`
  + `Secure` (prod), server-set only, and **re-validated against real membership
  every request** — a hand-edited cookie is inert.
- **Owner protection** — the last owner cannot be removed or demoted (guarded under
  a `pg_advisory_xact_lock` so concurrent removals can't drop an org to zero owners).
- **Secrets** — the service-role key, the Resend key and `CRON_SECRET` are
  encrypted **Worker secrets**, read at request time through `runtimeSecret()`;
  they are absent from the client bundle and from the deployed artifact, which
  `apps/web/scripts/assert-no-baked-secrets.mjs` proves on every build. `.env` is
  gitignored and never committed.

### 5.4 The isolation gate (CI)

`tests/isolation/cross-tenant.test.ts` **discovers every `org_id`-bearing table**
from `information_schema` and asserts each has FORCE RLS + a policy, seeds two orgs
(and a multi-org user), and proves zero cross-tenant rows + forged-context denial +
audit immutability. **A new table shipped without protection fails CI.** Currently
**29 tests, all green.**

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
  with identical key sets (**1,710 keys each**, parity checked by
  `npm run i18n:validate` on every push, along with ICU placeholder integrity and
  the Western-numerals rule).
- **Two registers, not one:** the studio's own surfaces are written in Egyptian
  Arabic; everything a CLIENT reads (the delivery portal, contract acknowledgement,
  variation decision, the quotation) is فصحى. See
  [`scripts/i18n/style-guide.md`](../scripts/i18n/style-guide.md).

---

## 7. Deployment

The full runbook — including rollback, migrations and the recovery procedures —
is [DEPLOY.md](DEPLOY.md). This section is the topology summary.

### 7.1 Topology
- **Cloudflare Workers** runs the app: worker **`metra-web`**, built from
  `apps/web` by **OpenNext** (`@opennextjs/cloudflare`), served at
  `https://metra-web.nabil-hakeem22.workers.dev` (a custom domain is added on the
  worker's Settings → Domains).
- **Postgres reaches Supabase through the `HYPERDRIVE` binding**, pointed at the
  Supabase **session pooler `:5432`**. The Worker never dials Supabase directly.
- **Supabase** project region `eu-west-1` (Postgres 17, Auth, and the private
  `metra-files` Storage bucket).
- **PDF rendering** runs on Cloudflare **Browser Rendering** through the `BROWSER`
  binding.
- **`workers/cron`** is a **second, separate Worker** (`metra-cron`), outside the
  npm workspaces, with its own `wrangler.jsonc` and its own deploy. It pings
  `/api/cron/automations` hourly and holds two settings that must agree with the
  app: `APP_ORIGIN` and `CRON_SECRET`.
- **Deploys are automatic:** `deploy.yml` runs on `workflow_run` of **CI** on
  `main` and is gated on the repository variable **`DEPLOY_ENABLED == 'true'`**, so
  a red build never ships and a merge does not deploy unless the flag is armed.
- Repo: `github.com/nabilhakeem22/Metra.app`.

### 7.2 Environment variables (build-time repo variables vs runtime Worker secrets)

The distinction is the whole point, and getting it wrong is how a secret ends up
in a build output — or how a value is set somewhere that reaches nothing.

**Build-time — repository Actions *variables*, inlined into the bundle:**

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public key |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public key |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar-EG` |
| `NEXT_PUBLIC_APP_URL` | the canonical origin; **a production build FAILS without it** (`next.config.mjs`), because every emailed link is derived from it |
| `CLOUDFLARE_ACCOUNT_ID` | used by `wrangler deploy` |
| `DEPLOY_ENABLED` | `true` arms `deploy.yml` |

**Runtime — encrypted *Worker secrets*, read per request via `runtimeSecret()`
(`apps/web/src/lib/cf/secrets.ts`):**

| Name | Used by |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts` — signed file URLs, identity lookups |
| `RESEND_API_KEY` | `lib/email/resend.ts` |
| `RESEND_FROM` | `lib/email/resend.ts` |
| `CRON_SECRET` | `api/cron/automations` — must match the value on `metra-cron` |

Set them with `npx wrangler secret put <NAME>` from `apps/web`; `wrangler deploy`
preserves them. Rotating one needs no rebuild.

> **The real gotcha.** What bakes a secret into the deployed artifact is **a
> `.env*` FILE being present when the build runs** — OpenNext compiles those files
> into `.open-next/cloudflare/next-env.mjs`, which ships inside the Worker. It is
> *not* `process.env` in server code: at runtime OpenNext copies the Worker's own
> vars and secrets into `process.env` per request. So the rule is mechanical —
> **no `.env*` file in a CI or deploy build** — and
> `apps/web/scripts/assert-no-baked-secrets.mjs` is what proves it did not happen,
> on every build, in both workflows.

`DATABASE_URL` and `DATABASE_POOL_URL` are **local-development and tooling**
values (migrations, the DB test suites, `next dev`). Production does not use
them: the Worker reaches Postgres through Hyperdrive. `next dev` loads
`apps/web/.env.local`, not the monorepo-root `.env`.

### 7.3 Database migrations & RLS
- Schema migrations: `npm run db:migrate` (Drizzle, `packages/db/migrations/`).
- RLS (roles, policies, SECURITY DEFINER functions): `npm run db:apply-rls` — an
  **idempotent** SQL apply (`functions → immutability → roles → policies`). RLS is
  *not* a Drizzle migration because Drizzle doesn't manage roles/policies/functions,
  and because on a fresh CI database those objects do not exist yet at migrate time.
- Seed (two orgs + a multi-org user, for the isolation gate): `npm run db:seed`.
- Before merging a migration, prove the database is ready:
  `npm run assert-schema-applied -w @metra/db` (read-only). See
  [DEPLOY.md](DEPLOY.md).

### 7.4 CI (`.github/workflows/ci.yml`)

On every push to `main` or a `validate/**` branch, against a Postgres 17 service
container, in this order:

1. `npm ci` (deterministic, from the committed lockfile)
2. **i18n validate** — key parity, ICU placeholders, Western numerals
3. **lint** — including the physical `left`/`right` ban
4. **unit tests (db)**, then **unit tests (web)**
5. **migrate** → **apply-rls** → **seed**
6. **the cross-tenant isolation gate**
7. **action-core DB tests** (`*.dbtest.ts`, seeded DB, fabricated `OrgContext`)
8. **the OpenNext Cloudflare build** (no deploy) — proves the Worker bundle builds
9. **`assert-no-baked-secrets`** — proves no secret was compiled into it

A green CI on `main` is what triggers `deploy.yml`.

### 7.5 Local dev
`npm install` → create `apps/web/.env.local` (copy of root `.env`) →
`npm run dev -w @metra/web`. Full setup and env docs in the root `README.md`.

---

## 8. Backlog from the P0 code review — where each item stands

The list below is the P0-era review backlog, kept because it is referenced from
[BUILD-LOG.md](BUILD-LOG.md). Each line now carries its **current** status, so it
can be read as a state of the system rather than as a list of open defects. None
of the original items was a tenant-isolation or secret defect — those held.

**Architecture (was: clear before P1 code)**

| Item | Status |
|---|---|
| Immutability-of-issued-objects DB pattern | **Done** — `enforce_immutable_when()` + SQLSTATE `MT100` on `proposals`, `contracts` and `variation_orders`, plus five `*_parent_draft` child triggers |
| A thin per-aggregate data-access layer | **Done** — `apps/web/src/lib/aggregates/` |
| Composite FKs over the per-row `enforce_same_org` trigger, plus an `org_id`/FK index convention | **Done** — `sameOrgFk()` (`schema/org-ref.ts`); the trigger is kept only for non-composite targets |
| An action-level test harness | **Done** — `apps/web/tests/actions/*.dbtest.ts` against a seeded database |

**Performance**

| Item | Status |
|---|---|
| `getOrgMemberIdentities` is a serial N+1 | **Still open** — `lib/team/identities.ts` calls `admin.auth.admin.getUserById` once per member, in a loop |
| Each authed page re-does auth work; dedupe with React `cache()` | **Still open** |
| DB `statement_timeout` / `connect_timeout` | **Done** — `statement_timeout 20s`, `lock_timeout 5s`, `idle_in_transaction_session_timeout 30s` per transaction (`org-context.ts`); `connect_timeout` in `packages/db/src/client.ts` |
| Fire-and-forget the invite email | **Partly** — still awaited in `inviteMember`, but bounded by `EMAIL_TIMEOUT_MS` so it cannot hang the action |
| A `memberships(user_id)` index | **Done** — `memberships_user_id_idx` |

**Security (was: before pilots)**

| Item | Status |
|---|---|
| Server-side rate limit + CAPTCHA on OTP send | **Still open.** The Workers rate-limit bindings cover the Public API only; `signInWithOtp` is not gated beyond Supabase's own limits |
| Set `NEXT_PUBLIC_APP_URL` in prod | **Done, and enforced** — a production build throws without it |
| Security headers + CSP | **Still open** — no `headers()` block in `next.config.mjs` |
| Input length caps | **Partly** — present on the paths that mattered (e.g. the 254-char email cap in `inviteMember`); not a systematic policy |
| Gate/rate-limit or remove the PDF spike | **Obsolete** — the spike route is gone; PDF is three auth-gated routes on the `BROWSER` binding |

**UX fixes (from the refine)**

| Item | Status |
|---|---|
| `isProfileComplete` rejected single-language firms | **Fixed** — one name **and** a city (`lib/org/profile.ts`) |
| The invite checklist item ticked on *accept*, not *send* | **Fixed** — a pending invitation ticks it (`lib/onboarding/progress.ts`) |
| The language switcher was labeled with the current language | **Fixed** — the `aria-label` names the destination; the visible badge deliberately shows the current locale and its currency symbol |

**Owner decisions (PRD §10) — none of these is closeable in code**

| Item | Status |
|---|---|
| PDPL hosting-region ruling (data is in `eu-west-1`, not Egypt) | **Open — owner** |
| Verify a Resend **sending domain** so invites deliver to anyone | **Open — owner.** Until then the test sender only reaches the account owner |
| Rotate the DB password | **Open — owner** |
| Trademark/domain for "Metra / ميترا" | **Open — owner** |
| Validate the مستخلص template against real certificates | **Open — owner** |

---

## Immutability

Two mechanisms make records tamper-resistant. Pick per the matrix:

| Need | Mechanism |
|---|---|
| Append-only ledger (never edited, e.g. `audit_log`) | GRANTs — `metra_app` gets `select, insert` only (no `update`/`delete`) |
| Status-locked business row (e.g. a sent proposal, a signed contract, an issued variation) | `enforce_immutable_when()` trigger factory |

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

## Composite same-org foreign keys

Prefer `sameOrgRef` / `sameOrgFk` (`packages/db/src/schema/org-ref.ts`) for
child→parent references within an org. The composite FK `(org_id, <name>_id) ->
target(org_id, id)` makes a cross-org reference impossible at the database
(requires the target's universal `unique(org_id, id)`), and ships an
`(org_id, <name>_id)` index. The older `enforce_same_org()` trigger is deprecated
for hot paths (kept only for non-composite / cross-schema targets).
