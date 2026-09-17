# Metra

**Project and cost control for fit-out contractors** · *إدارة وتكاليف مشاريع التشطيبات*

Bilingual (Arabic/English, RTL-first) multi-tenant SaaS for Egyptian interior
fit-out and finishing firms.

**P0 — Foundations** (multi-tenant auth, roles, org onboarding, bilingual/RTL
shell, design system, file storage, audit log) and the **P1 commercial spine**
(price book → clients → projects → proposals → contracts → BOQ → variation
orders) are both shipped, along with the **design-engagement machine** and its
client delivery portal, and a read-only **Public API v1**. 46 tables, every one
of them under row-level security, with cross-tenant isolation proven by an
automated gate in CI.

The released system is documented in
[docs/P0-TECHNICAL-GUIDE.md](docs/P0-TECHNICAL-GUIDE.md); deployment in
[docs/DEPLOY.md](docs/DEPLOY.md); the Public API in [docs/API.md](docs/API.md).

> The git remote is named `Metra.app`; the product and all code identifiers use
> `Metra` / `@metra/*`. That mismatch is intentional — do not "fix" it.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind (logical properties), shadcn/ui |
| i18n | next-intl (`ar-EG` default, `en`) |
| Database | Postgres (hosted Supabase), RLS-enforced multi-tenancy |
| ORM | Drizzle over postgres.js |
| Auth | Supabase Auth (email OTP; phone OTP path in place) |
| Files | Supabase Storage, signed URLs, private `metra-files` bucket |
| PDF | `@cloudflare/puppeteer` on the Worker's `BROWSER` binding (Cloudflare Browser Rendering), embedded Arabic fonts |
| Hosting | **Cloudflare Workers** — worker `metra-web`, built by OpenNext (`@opennextjs/cloudflare`); Postgres reached through the `HYPERDRIVE` binding |
| Tests | Vitest |

## Workspace layout

```
merta/
  apps/web        @metra/web  — Next.js app (deployed as the `metra-web` Worker)
  packages/db     @metra/db   — Drizzle schema, RLS SQL, migrations, seed, isolation test
  workers/cron    (separate)  — scheduled Worker; NOT an npm workspace
```

Managed with **npm workspaces** (no pnpm) — but only the first two.

`workers/cron` is **outside the workspace globs on purpose**: it is its own
wrangler project with its own `wrangler.jsonc`, and a root `npm ci`, `npm run
lint` or `npm test` does not see it. Changing it means installing, checking and
deploying it on its own. Deployment: [docs/DEPLOY.md](docs/DEPLOY.md).

## Prerequisites

- Node.js >= 20 to run the app. **The Cloudflare toolchain needs Node 22** —
  the pinned wrangler requires it, and `ci.yml` / `deploy.yml` both use 22.
- npm >= 10
- A Supabase project (hosted). No local Postgres or Docker required to run the
  dev server — but the two **database test suites refuse to run against a
  non-local host** (`assertLocalDatabase`), so exercising those needs a local
  Postgres. See [docs/DEPLOY.md](docs/DEPLOY.md) → *Testing against a database*.

## Setup (a new dev should ship in a day)

```bash
# 1. Install everything (root installs all workspaces)
npm install

# 2. Configure secrets
cp .env.example .env
#   then fill .env with the real Supabase keys and connection strings.
#   .env is gitignored — never commit it.

# 3. Apply the schema + RLS to YOUR OWN Supabase project
#    WARNING: these three write DDL. If .env still points at the shared
#    project, this is a production operation - see docs/DEPLOY.md.
npm run db:migrate      # drizzle migrations via the session pooler (:5432)
npm run db:apply-rls    # roles, FORCE RLS, isolation policies, triggers

# 4. Seed two demo orgs (used by the isolation test)
npm run db:seed

# 5. Run the app
npm run dev             # http://localhost:3000 -> /ar-EG
```

## Environment variables

See `.env.example` for the full list. Key notes:

| Var | Use |
|---|---|
| `DATABASE_URL` | Session pooler `:5432`. Migrations, `apply-rls`, seed, and the DB test suites. IPv4-friendly. |
| `DATABASE_POOL_URL` | Transaction pooler `:6543`, `prepare:false`. **Local/dev runtime only** — in production the Worker reaches Postgres through the `HYPERDRIVE` binding, not through this. |
| `DIRECT_URL` | Direct `:5432`. May be IPv6-only. Carried in `.env.example` for manual `psql` use; **no code reads it**. |
| `NEXT_PUBLIC_SUPABASE_*` | Browser-safe Supabase URL + anon/publishable keys. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Full bypass. Never sent to the client. |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar-EG`. |

## Scripts (root)

| Script | Does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build of the web app |
| `npm run lint` | ESLint (includes the physical-left/right ban) |
| `npm run test` | Unit tests (web + db) |
| `npm run test:actions` | Action-core DB tests (needs a seeded LOCAL DB) |
| `npm run test:isolation` | Cross-tenant RLS isolation test (needs a seeded LOCAL DB) |
| `npm run i18n:validate` | Message-key parity, ICU placeholders, Western numerals |
| `npm run docs:check` | Docs gate: no root `DEPLOY.md`, no stale-host mention outside `docs/BUILD-LOG.md`, no dash inside Arabic prose |
| `npm run db:generate` | Generate a Drizzle migration from schema changes. ⚠️ **Read [docs/DEPLOY.md](docs/DEPLOY.md) first.** It diffs `src/schema/` against `migrations/meta/0051_snapshot.json`, and it can open drizzle-kit's interactive **rename prompt**, which cannot run headless. Migrations 0013–0051 were hand-authored. |
| `npm run db:assert-snapshot` | Proves `migrations/meta/0051_snapshot.json` still describes `src/schema/`. Opens **no database** (~2 s); CI runs it on every push. |
| `npm run db:generate-baseline` | Rewrites that one snapshot file after a deliberate schema change. Writes nothing else, asks nothing, touches no database. |
| `npm run db:migrate` | Apply migrations to the DB (`DATABASE_URL`) |
| `npm run db:apply-rls` | Apply roles + RLS policies + trigger functions |
| `npm run db:seed` | Seed two demo orgs |

## Multi-tenancy model (read before touching data)

Business tables carry `org_id UUID NOT NULL` and have **`FORCE ROW LEVEL
SECURITY`**. The connection identity is the `postgres` role, which owns the
tables; `FORCE` is what makes even the owner obey policies. Inside every request
we `SET LOCAL ROLE metra_app` (a `NOLOGIN NOBYPASSRLS` role) and set
`app.current_org_id` / `app.current_user_id` as `SET LOCAL` config. Policies key
every row to `current_setting('app.current_org_id')`.

**The only sanctioned way to read/write business tables is `withOrgContext`**
(`apps/web/src/lib/db/context.ts`). Never issue a business-table query outside it.

## Conventions

- **No physical `left`/`right`** in CSS, Tailwind classes, or inline styles —
  use logical properties (`ms-`, `me-`, `start-`, `end-`, `text-start`). Enforced
  by ESLint.
- **Western numerals** everywhere in both locales (`Intl … -u-nu-latn`).
- Dates `DD/MM/YYYY`, stored UTC, rendered `Africa/Cairo`.
- Money is `NUMERIC(18,4)`; carried as **string** in JS, never float.
- No brand name in DB/table/column/enum identifiers.
