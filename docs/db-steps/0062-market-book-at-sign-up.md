# 0062 and the market price book at sign-up: owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Every new studio gets the market price book automatically right after
sign-up (the onboarding screen fires it as a request of its own once the
studio exists, so it never slows or fails the sign-up), and an empty price
book offers the same load as a button. Both read a derived table,
the **seed book** (`market_seed_book`): every published market item as a
studio's price book would receive it, built by the same code as
`market:seed-price-books`. This is its ONE database step: migration
`0062_market_seed_book.sql` plus one policy and one grant under `rls/`. It is
validated on branch `validate/market-seed-on-signup`.

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below): the
   table, its RLS, and the seed book built from what is published, while
   production still runs the current `main`.
2. **Then** the branch is merged to `main` and deployed, and you run the
   smoke test (step 5).

Why this order, one sentence each:

- **The new code needs 0062, with the book built:** the sign-up seed (`POST
  /api/price-book/market-seed`) and the empty price book's button read
  `market_seed_book`; without the table they fail with 42P01, and with the
  table still empty a new studio gets nothing and the button says the book
  is being prepared. A sign-up itself always succeeds (the seed is a separate
  request, and its failure is one log line with a reference).
- **The current Worker is safe on the 0062 database:** 0062 only adds a table
  nobody reads yet.
- **There is no rollback floor:** the table is derived data; any Worker
  version runs on it.

**What it changes.** No row is touched and nothing is backfilled.

| Object | Change |
|---|---|
| `market_seed_book` | new platform-level table (no `org_id`), one row per published market item: code, seeded names, the forms a studio's own item clashes with, studio unit, cost and cost x 1.05, sub-category. FK to `market_items` (on delete cascade). Starts EMPTY |
| `rls/policies/60-market.sql` | RLS enabled and forced on it, one SELECT policy `market_read` (a member org context) |
| `rls/roles.sql` | `metra_app` gets SELECT on it and nothing else |

Who writes it: `market:publish` and `market:withdraw` rebuild it whole in
their own transaction; `market:rebuild-seed-book` rebuilds it and seeds no
studio (step 3); and every REAL `market:seed-price-books` run (not a dry run)
rebuilds it under the market write lock before it seeds. The app only
reads it. A seed writes each item BY REFERENCE to it (its names and prices are
taken from the book), so a seed holds the book steady for the length of one
studio's transaction, the app's and a real CLI run's alike. Between two
studios a CLI run holds nothing: each studio's transaction checks the book is
still the one the run planned from, and when a publish or withdrawal changed
it the run stops there (`STOPPED`, exit 1) and a re-run plans from the new
book. A `market:publish` or `market:withdraw` that meets a seed waits up to
3 s and then stops with a lock timeout that names the holder; run it again a
moment later.

**1. Put the code in the production checkout.**

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/market-seed-on-signup
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat a01ffb84 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (a01ffb84)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor), each block ON ITS OWN.

(a) Expect `migrations` 62 and `newest` 1792248953024 (0061's journal stamp).

```sql
-- 0062 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK: `seed_book` 0, or STOP.**

```sql
-- 0062 step 2 (b): the pre-check. Run this one alone.
select count(*) as seed_book from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'market_seed_book';
```

**3. Migrate, apply RLS, prove it landed, then build the seed book.** From
`C:\Users\HP\merta-main`, in a PowerShell window where you also set
`$env:MARKET_DATABASE_URL` as in *Monthly market bulletin* (the direct or
session-pooler connection, never the `:6543` transaction pooler):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
npm run market:rebuild-seed-book
```

Expect `Migrations applied.`, then `apply-rls: verified in the catalogues — 52
tables, 52 policies, 15 triggers, 44 functions, ...` and a `grants verified`
line naming 11 narrowed tables (`market_seed_book` among them), then
`assert-schema-applied: OK — 52 declared table(s), every column present.`,
then `market:rebuild-seed-book: the seed book holds 456 published market
item(s); no studio was seeded` (456 with July 2026 published; 0 with no
bulletin, and the first `market:publish` builds it). It writes the book only:
no studio row, ever.

**4. Read-only, after.** Each block ON ITS OWN.

(a) `migrations` 63 and `newest` 1792272891040 (0062's journal stamp): step 2
(a) again.

(b) One row: `rls` true, `forced` true, `policies` 1, `app_select` true,
`app_writes` false, `api_roles_read` false, `entries` the number step 3
printed (456 for July 2026).

```sql
-- 0062 step 4 (b): the seed book's RLS and grants, and its size. Run this one alone.
select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('metra_app', c.oid, 'select') as app_select,
       has_table_privilege('metra_app', c.oid, 'insert')
         or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete') as app_writes,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read,
       (select count(*) from public.market_seed_book) as entries
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'market_seed_book';
```

**5. Afterwards: merge, smoke test.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Tell the lead the database step is done; the lead merges and the Deploy
   workflow deploys.
3. Smoke test, with the log open (`npx wrangler tail metra-web` from
   `C:\Users\HP\merta-main\apps\web`): sign up a test studio with a second
   email address. Its price book lists the market items within a few
   seconds (a reload may be needed), and the log shows no `42P01`, `42501` or
   `mutateInOrg failed` line. Tell the lead which test studio to remove.
4. Put the production checkout back on main (`git switch --detach
   origin/main` after a fetch).

**Undo, if ever needed.**

**(1) The code:** `npx wrangler rollback <version-id>` with the version that
served before the merge. Leave the database alone: the older Worker never
reads the table.

**(2) The schema, only if this is abandoned:** roll the code back FIRST (1),
then run `drop table if exists public.market_seed_book;` on its own, and tell
the lead: its policy leaves `60-market.sql` and its grant leaves `roles.sql`
in the same revert, or the next `db:apply-rls` fails on the missing table.

**(3) The seeded items:** a studio seeded at sign-up or from its empty price
book has the same `MKT-` codes and market links as one the CLI seeded, so the
undo of *Seeding studio price books from the market book* removes them too.
