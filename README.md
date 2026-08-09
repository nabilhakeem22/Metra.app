# Metra

**Project and cost control for fit-out contractors** · *إدارة وتكاليف مشاريع التشطيبات*

Bilingual (Arabic/English, RTL-first) multi-tenant SaaS for Egyptian interior
fit-out and finishing firms. This repository contains **P0 — Foundations**:
multi-tenant auth, roles, org onboarding, bilingual/RTL shell, design system,
file storage, and an audit log, with row-level-security cross-tenant isolation
proven by an automated test.

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
| PDF | Puppeteer (`puppeteer-core` + `@sparticuz/chromium` in prod), embedded Arabic fonts |
| Tests | Vitest |

## Workspace layout

```
merta/
  apps/web        @metra/web  — Next.js app
  packages/db     @metra/db   — Drizzle schema, RLS SQL, migrations, seed, isolation test
```

Managed with **npm workspaces** (no pnpm).

## Prerequisites

- Node.js >= 20 (developed on v24)
- npm >= 10
- A Supabase project (hosted). No local Postgres or Docker required for dev.

## Setup (a new dev should ship in a day)

```bash
# 1. Install everything (root installs all workspaces)
npm install

# 2. Configure secrets
cp .env.example .env
#   then fill .env with the real Supabase keys and connection strings.
#   .env is gitignored — never commit it.

# 3. Apply the schema + RLS to your Supabase project
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
| `DATABASE_URL` | Session pooler `:5432`. Migrations + isolation test. IPv4-friendly. |
| `DATABASE_POOL_URL` | Transaction pooler `:6543`. App runtime client (`prepare:false`). |
| `DIRECT_URL` | Direct `:5432`. May be IPv6-only. Fallback only. |
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
| `npm run test:isolation` | Cross-tenant RLS isolation test (needs a seeded DB) |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
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
