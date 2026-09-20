# Stack Profile

> **Status: ACTIVE.** Every build-squad agent reads this first. Project-specific
> facts live here so the agent prompts stay stack-agnostic. `—` = infer it
> yourself; `DECIDE` = not yet settled, surface it in the assumption ledger.

Metra (ميترا) — bilingual, multi-tenant SaaS for Egyptian interior fit-out
contractors (quote → contract → مستخلص invoicing; project & cost control).

---

## Refactoring Rulebook (Nabil's — HARD, applies to all code)

1. **Single Responsibility** — a file/class/function does exactly one thing. At
   ~30-line functions or ~150-line files, **PAUSE and ask** before splitting.
   Apply with judgment, not as an auto-split: message catalogs (`messages/*.json`),
   drizzle migrations, and multi-tab profile pages legitimately exceed 150 lines
   where cohesion beats line-count — flag, don't shatter.
2. **Zero dead code** — delete superseded code immediately (no "just in case"
   comments, no commented-out blocks); remove unused imports in every file you touch.
3. **Explicit separation of concerns** — UI, business logic, external integrations,
   and validation never share a file; cross-module data flows through explicit,
   strictly-typed interfaces. (Mirror the existing `{core,queries,actions}` + tab
   split.)
4. **Intent-revealing names** — no abbreviations (`fetchUserData`, not `getUsrDat`);
   variables describe their data, functions describe their action.
5. **Boy-scout rule** — leave code cleaner than found; adding a feature to a messy
   file, refactor the immediate surrounding code first, then add the feature.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind (logical properties only) · shadcn/ui + Radix · next-intl · next-themes · IBM Plex Sans + Plex Sans Arabic via `next/font` |
| Backend | Next.js server actions + route handlers (Node runtime); no separate backend |
| Database | PostgreSQL 17 (Supabase, region eu-west-1) · Drizzle ORM |
| Storage / files | Supabase Storage — private `metra-files` bucket, signed URLs |
| Cache / queue | — (none) |
| Hosting | **Cloudflare Workers** — Worker `metra-web`, built by OpenNext (`@opennextjs/cloudflare`), Postgres via the **Hyperdrive** binding to the Supabase **session pooler :5432**. GitHub `nabilhakeem22/Metra.app`; `deploy.yml` runs on `main` but is **gated on the `DEPLOY_ENABLED` flag**, so a merge does not deploy by itself. |
| Package manager | npm **workspaces** monorepo: `apps/web` (`@metra/web`), `packages/db` (`@metra/db`). **`workers/cron` is a SEPARATE wrangler project, outside the workspace globs** — it has its own `wrangler.jsonc` and is not installed, linted or tested by the root scripts. Changing it means deploying it on its own. |

## Commands

Agents run these literally. These are exactly what `.github/workflows/ci.yml` runs.

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Dev server | `npm run dev -w @metra/web` *(needs env in `apps/web/.env.local` — root `.env` isn't auto-loaded by `next dev`)* |
| Build | `npm run build -w @metra/web` |
| Unit tests (web) | `npm run test -w @metra/web` |
| Unit tests (db) | `npm run test -w @metra/db` |
| Action-core DB tests | `npm run test:actions -w @metra/web` *(seeded DB via `apps/web/tests/actions/fixture.ts`; **`assertLocalDatabase` refuses a non-local host** — CI, or a local docker Postgres)* |
| Cross-tenant isolation gate | `npm run test:isolation -w @metra/db` *(same local-only guard)* |
| E2E tests | — (none) |
| Lint | `npm run lint` *(root; includes `metra/no-physical-inline-direction`)* |
| i18n gate | `npm run i18n:validate` *(key parity, ICU placeholders, Western numerals — no API key, never calls Gemini)* |
| Docs gate | `npm run docs:check` *(`docs/DEPLOY.md` is the ONLY `DEPLOY.md` in the tree — walked, so an untracked copy counts; no stale-host mention in a tracked `*.md` outside `docs/BUILD-LOG.md`; no em/en dash inside Arabic prose)* |
| Type check | `cd apps/web && npx tsc --noEmit` — **and the same in `packages/db`**; they are two tsconfigs and only one of them is in the CI build step |
| Migrations | `npm run migrate -w @metra/db` **then** `npm run apply-rls -w @metra/db` (RLS/roles/functions) **then** `npm run seed -w @metra/db` |
| New migration | `npm run generate -w @metra/db` — ⚠️ drizzle-kit's rename prompt is an interactive TUI that can't run headless; 0013–0051 were hand-authored. The baseline snapshot is the one the NEWEST `meta/_journal.json` entry names (today **`migrations/meta/0051_snapshot.json`**), which is what `generate` diffs against; `db:assert-snapshot` and `db:generate-baseline` derive it from the journal rather than naming it. Read `docs/DEPLOY.md` before using it. |
| Snapshot gate | `npm run db:assert-snapshot` *(regenerates into an empty temp dir and deep-compares; **no database**, ~2 s; **CI runs it on every push**, with `DATABASE_URL` removed from that step's env). Fix a difference with `npm run db:generate-baseline`, never with an in-place `generate`. **`drizzle-kit` is pinned EXACTLY at `0.28.1`** in `packages/db` — the committed snapshot is that version's byte output, so the generator version is part of the artefact.)* |

## Conventions

- **Test framework:** Vitest.
- **Test file location/naming:** action-core DB tests `apps/web/tests/actions/*.dbtest.ts` (pure `*Core(ctx,input)` against a seeded DB via fabricated `OrgContext`); the auto-discovering isolation gate `tests/isolation/*.test.ts`; unit `*.test.ts` colocated.
- **Error handling:** unified `ActionResult` + `ActionCode` union + `resolveActionError(code,t)` (localized, never raw English). `mutateInOrg` catches and returns coded errors. Server actions RETURN `ActionResult` — never throw to the client. Modal/form callers MUST wrap awaits so a rejected action can't leave a spinner stuck.
- **Logging:** `console.error` on the server. Read it with **`npx wrangler tail`** (live) or the Workers Logs view in the Cloudflare dashboard. Never log PII, secrets, tokens, or raw share tokens (store only the sha256 hash).
- **Naming:** intent-revealing, no abbreviations (Rulebook #4).
- **Folder structure:** per-domain `apps/web/src/lib/{module}/{core,queries,actions}.ts`; schema `packages/db/src/schema/*.ts`; RLS `packages/db/src/rls/{functions/*,policies/*,roles,immutability}.sql`, applied in the order `rls/manifest.ts` declares; UI `apps/web/src/app/[locale]/(app)/{module}/`.
- **Anything the coder must mirror (exemplars):**
  - Tabbed feature → `apps/web/src/app/[locale]/(app)/clients/[id]/` (server `page.tsx` + `'use client'` `profile-tabs.tsx` + **server-safe `tabs.ts`** + per-tab server/client components).
  - Domain lib → `apps/web/src/lib/client-contacts/{core,queries,actions}.ts`.
  - Schema-only migration → `packages/db/migrations/0015_project_profile.sql`.
  - RLS for a new table → add to the right `rls/policies/*.sql` + `rls/roles.sql` (NOT the migration). A NEW `.sql` file under `rls/` must also be added to `rls/manifest.ts`, or it is never applied and nothing says so.
- **Money law:** EGP; `numeric(18,4)` carried as a string; piastre-exact BigInt math (round half-up), never float; rendered IBM Plex Mono, tabular, `direction:ltr`, `text-align:end`.
- **No demo/fake data** — honest empty states + "activates with X" locked states for not-yet-built dependencies.

## Auth model

- **Provider:** Supabase Auth — email + phone **OTP** (magic-code). `requireOrg()` / `getSessionUser()`; `metra_active_org` cookie for the org switcher.
- **Roles / permissions:** 7-role §2.2 matrix (owner · admin · project_manager · site_engineer · accountant · viewer · client) × capability grid in `apps/web/src/lib/permissions/matrix.ts`; resolve via `can(role, capability, action)`.
- **Where authorization is enforced:** server-side — `mutateInOrg(ctx,{capability,action},fn)` gates the capability + audits BEFORE `withOrgContext`; Postgres RLS is a second factor; pages guard with `can()`. A hidden UI button is NOT a gate — server actions are directly invokable, so gate the action.
- **Session/token handling:** Supabase cookies. Public share links (proposal accept) use a 256-bit token, sha256-hashed, single-use/expiring, resolved by SECURITY DEFINER functions.

## Tenancy

- **Multi-tenant?** Yes — per **organization**. This is the crown jewel; any added client/section/type/stage/contact/activity/document must be visible ONLY within its own tenant.
- **Isolation mechanism:** FORCE RLS on every table; `withOrgContext` sets GUCs (`app.current_org_id`/`current_user_id`/`current_user_email`) + `SET LOCAL ROLE metra_app` (NOLOGIN, NOBYPASSRLS); `org_isolation` policy = org match **AND** `app_is_current_org_member()` (membership second factor). The isolation gate `tests/isolation/cross-tenant.test.ts` auto-discovers every `org_id` table and fails CI if any lacks FORCE RLS + policy.
- **Where tenant leakage would be most likely:** the public token surfaces (`/p/[token]` SDFs — must OMIT every cost/margin column); polymorphic `activities.entity_id` (no FK — core must verify the parent loads in-org); any NEW org-scoped table missing from the isolation gate, `fixture.ts` teardown, or `apply-rls`.

## Locale / i18n

- **Languages:** `ar-EG` (default, **RTL**) and `en` (LTR), via next-intl. Message catalogs `apps/web/src/messages/{ar-EG,en}.json` — **identical key sets are enforced** (parity check). A key referenced in code but absent in BOTH files passes parity yet throws `MISSING_MESSAGE` at runtime — verify dynamic keys (`t(\`kinds.${x}\`)`) exist.
- **RTL required?** Yes — **logical CSS only** (ESLint `metra/no-physical-inline-direction`; no left/right, use start/end).
- **Date / number / currency:** **Western (Latin) numerals ONLY (§4.1)** — zero Arabic-Indic digits in any rendered figure, both locales. Money per the Money law above.
- **Timezone:** dates stored as `date`; timestamps `timestamptz`.

## Scale targets

Estimates (pilot phase — the 5 pilot firms are an open PRD §10 decision):
- Users: `DECIDE` (est. low hundreds across pilots)
- Records in the largest table: `DECIDE` (est. `proposal_lines` / `cost_items`, low thousands per org; fit-out BOQs run to hundreds–thousands of lines)
- Concurrent users at peak: `DECIDE` (est. low)
- Largest single payload / file: Excel price-book import; Puppeteer PDF render of a large proposal

## Performance budgets

- p95 API latency: `DECIDE`
- Page load: `DECIDE`
- PDF render: target < ~5s (P0 spike). Pre-pilot debt: the **N+1 identity
  resolver** (`lib/team/identities.ts` calls `getUserById` once per member) and
  the **per-page repeated auth work** (no React `cache()` dedupe). The DB
  timeouts are DONE and so is the PDF throttle (503 + `retry-after: 5` at the
  renderer's concurrency cap).
- **Two `lock_timeout`s, on two different connections — do not quote one for the
  other.** The **app request** transaction uses `lock_timeout 5s` /
  `statement_timeout 20s` / `idle_in_transaction_session_timeout 30s`
  (`packages/db/src/org-context.ts`). The **schema-changing scripts**
  (`db:migrate`, `db:apply-rls`, the fixture purge) use
  **`MIGRATION_LOCK_TIMEOUT = '3s'`** (`packages/db/src/scripts/lock-timeout.ts`),
  set with `set_config` and **read back from `pg_settings`** before any DDL runs
  because Supavisor discards startup parameters. Both also set a
  **`statement_timeout`**, read back the same way: **`db:apply-rls` 60 s**
  (catalogue-only DDL) and **`db:migrate` 120 s** — double, because a migration
  may SCAN (0052 runs twelve `VALIDATE CONSTRAINT`s, 0053 ten index builds). It
  bounds each STATEMENT, not the batch. `lock_timeout` bounds lock ACQUISITION
  only: once a statement HOLDS its lock, `statement_timeout` is the only thing
  between a stalled scan and a script that waits for ever with the schema locked.
- Measured margins, so nobody re-derives them from the wrong number: 0049 + 0050
  hold ACCESS EXCLUSIVE for **~630 ms** against the migrator's **3 s** — a
  **~4.8× self-abort margin**, NOT the "~8×" that came from comparing it against
  the app's 5 s. `apply-rls`'s worst case is one file, not the run:
  `policies/10-catalogue.sql` locks **11 tables** in one implicit transaction, so
  **11 × 3 s = 33 s** is the bound if every one of them is blocked (the split
  from one `policies.sql` cut this from 46 tables at once). See `docs/DEPLOY.md`.

## Third-party integrations

| Service | Used for | Failure mode if it's down |
|---|---|---|
| Supabase | Auth + Postgres + Storage | App auth/data down; the SHARED DB is dev+CI-adjacent+prod — a pause makes the whole app unreachable |
| Resend | Transactional email (OTP, invites, proposal-sent) | No emails; proposal-send email is **best-effort/non-blocking**. ⚠️ Sending domain NOT yet verified — email only reaches the account owner until then (owner action) |
| Cloudflare | Hosting (Workers), Hyperdrive to Postgres, Browser Rendering, the API rate-limit binding | No deploys; a Hyperdrive outage takes the DB path down. A rate-limiter blip fails OPEN by design (docs/API.md) |
| `@cloudflare/puppeteer` + the `BROWSER` binding | PDF generation | No PDF. At the renderer's concurrency cap the routes return a retryable **503 + `retry-after: 5`**, not a 500 |
| Paymob / ETA e-invoicing | Payments (subscription) + Egyptian e-invoicing | Not built — future Subscription + Public-API slices |

## Compliance / regulatory

- **PDPL** (Egypt data protection): data is currently in the EU (Supabase eu-west-1), NOT Egypt — residency is an OPEN decision (PRD §10 #1; region can't change without re-provisioning).
- Egyptian **VAT 14%**; **مستخلص** progress certificates; **ETA e-invoicing** required to invoice businesses in Egypt (future, for selling the SaaS itself).
- Font licensing: IBM Plex Sans/Arabic + Cairo proceed on OFL basis.

## Domain edge cases

The inputs that are weird *in Egyptian fit-out specifically* — this is what makes tester-functional sharp:
- **Money:** piastre-exact, never float. Percentage fields (discount, **supervision** [after-VAT, untaxed], advance, retention) are `[0,100]` — DB CHECK enforced (SQLSTATE 23514). Supervision base = works value after doc discount.
- **Money parser:** reject comma-decimal corruption (`1,5`→ must NOT become `15`); Arabic normalization for matching (أ/إ/آ→ا, ة→ه); Arabic-Indic digits rejected as input.
- **Bilingual:** `bilingualCheck` = name_ar OR name_en present (whitespace-safe). Arabic cursive joining breaks per-character typewriter animation (use fade, not typewriter, for Arabic).
- **Immutability:** proposals lock on `send` (`enforce_immutable_when`, SQLSTATE MT100); children editable only while parent is `draft`. Accept/reject metadata lives in an append-only events table (the locked row can't hold it).
- **Concurrency:** state transitions MUST be atomic admission gates (`UPDATE ... WHERE status=... RETURNING`, check rowCount) — not read-then-write; per-org `pg_advisory_xact_lock` for number allocation.
- **Client-facing hiding:** the `client` role is fenced out of the internal app (portal is P4). Cost/margin never reaches a client surface — `canSeeMargin`, the PDF `variant:'client'` (cost not even loaded), and the public token SDFs all strip it.
- **Configurable-as-data:** sections, project types, and stage templates are org-editable tables (only the seed defaults are hardcoded); project stages support **start-from-any-phase** (mark done/skipped, set current — no forced linear order).

## Hard constraints

The architect may not design around these:
- **The Refactoring Rulebook** (above).
- **Migrations = schema + data-backfill ONLY.** NEVER `create policy`, `grant … to metra_app`, or reference an apply-rls function (`app_is_current_org_member()` etc.) inside a migration — those objects don't exist yet on a fresh CI DB at migrate time (this broke CI on 0013/0014). RLS lives ONLY in `rls/policies/*.sql` + `rls/roles.sql`, applied by `apply-rls` AFTER migrate.
- **`rls/**.sql` is exempt from the 150-line rule.** Split at function and domain
  boundaries only; never inside one SDF or one table's policy block. The apply
  order is `rls/manifest.ts` and nothing else — a `.sql` file under `rls/` that
  is not in the manifest is NEVER APPLIED, silently, and
  `rls/functions-order.test.ts` is what fails on it.
- **Server-safe constants:** never export a value/const from a `'use client'` module and import it into a server component — it becomes a client-reference proxy → runtime 500 (passes tsc/build). Shared constants live in a plain non-client module (see `tabs.ts`).
- Every new org-scoped table → isolation gate coverage + `fixture.ts` teardown (FK-safe order) + RLS in `apply-rls`.
- Message-key parity + Western numerals; logical CSS only; no demo data.
- **The CI from-scratch replay (`.github/workflows/ci.yml`: i18n→docs→lint→unit(db)→snapshot→unit(web)→migration-batch-size→migrate→apply-rls→seed→isolation→test:actions→OpenNext build→assert-no-baked-secrets on a fresh Postgres) is the REAL gate.** Local checks use the already-migrated warm DB and miss clean-room failures. Verify CI green after every push.
- **Workflow:** plan & confirm (architect → owner sign-off) before the coder writes code. Keep every mutation a self-contained `*Core(ctx,input)→ActionResult` (API-ready — a future Public API slice wraps them).

## Out of bounds

Never modify without explicit instruction:
- Don't inline RLS/policies/grants into migrations (see above).
- Don't export values from `'use client'` modules into server components (see above).
- Don't commit secrets — `.env` is gitignored; secret-check before every push (grep for the DB password / `re_` Resend key / service-role JWT).
- Don't run heavy load / bulk-write benchmarks against the shared Supabase DB (a reviewer corrupted state doing this).
- Don't rename the GitHub repo (`Metra.app`) or the local folder (`C:\Users\HP\merta`).
- Don't touch the PDF/email template branding pending the certificate (P3) / `metra.app` domain decision.
