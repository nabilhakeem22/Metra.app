# 0061 and the market price book database step: owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

The market price book has ONE database step, and this is it: migration
`0061_market_price_book.sql` plus one new policy file and one new grant under
`rls/`. It is validated on branch `validate/market-price-book`, which also
carries `validate/landing-screens` (cdbf99d): its `db:apply-rls` keeps that
branch's `40-delivery-read.sql` fix.

**THE ORDER (do not change it):**

1. **The database goes first**, from the `validate/market-price-book` branch
   (steps 1 to 4 below), while production still runs the current `main`.
2. **Then** the branch is merged to `main` and deployed (the Deploy workflow
   green), and you run the smoke test (step 5).

Why this order, one sentence each:

- **The new code needs 0061:** every read of `cost_items` now names
  `market_item_id`, so new code on a database without 0061 fails every price
  book page with 42703.
- **The current Worker is safe on the 0061 database:** 0061 only ADDS (a
  nullable column, five enum labels, five new tables nobody reads yet). A
  tester ran main's own action tests on a 0061 database: 1062 of 1063 passed,
  exactly as on a 0060 one (the one failure is a harness artefact of that
  test machine, on both).
- **The rollback floor arrives with the first new unit, not with 0061:** see
  *Rolling back*.

**What it changes.** No row is touched and nothing is backfilled.

| Object | Change |
|---|---|
| `cost_item_unit` | five labels appended: `kg`, `ton`, `liter`, `cbm`, `roll`. IRREVERSIBLE (Postgres cannot drop an enum label); harmless while unused |
| five new enum types | `market_publisher`, `market_bulletin_status`, `market_unit`, `market_item_status`, `market_observation_status` |
| five new tables | `market_categories`, `market_items`, `market_bulletins`, `market_price_observations`, `market_item_details`: platform-level (no `org_id`), empty until the first `market:publish` |
| CHECKs on the data | a price is above 0 and at most 10,000,000, and no month is after its bulletin's month (the observation carries its bulletin's month through a composite FK); each bulletin records the gate's git commit |
| `cost_items.market_item_id` | new, nullable, every row NULL; FK to `market_items` (on delete restrict, added NOT VALID then validated) and the partial index `cost_items_org_market_item_idx` |
| `rls/policies/60-market.sql` | the five tables: RLS enabled and forced, one SELECT policy `market_read` each (a member org context; published bulletins only; an item only while a published bulletin prices it) |
| `rls/roles.sql` | `metra_app` gets SELECT on the five tables and nothing else |

**1. Put the market price book code in the production checkout.** Detach onto
the branch. This step adds a workspace package (`packages/market-ingest`) and
no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/market-price-book
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 4ab2d5d HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (4ab2d5d)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN: paste it,
run it, note the result, then the next one.

(a) How many migrations are recorded. Expect `migrations` 61 and `newest`
1791767848859 (0060's journal stamp).

```sql
-- 0061 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP.** `server_ok` true (0061
needs PostgreSQL 12 or later; Supabase runs 17), `cost_item_units` exactly
`sqm,linear_meter,pcs,lump_sum,day`, and `market_relations`,
`market_types` and `link_column` all 0. Anything else means part of the
market price book is already in this database: do not run step 3, tell the
lead.

```sql
-- 0061 step 2 (b): the pre-check. Run this one alone.
select current_setting('server_version_num')::integer >= 120000 as server_ok,
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'cost_item_unit') as cost_item_units,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname like 'market\_%') as market_relations,
       (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public' and t.typname like 'market\_%') as market_types,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'cost_items' and column_name = 'market_item_id') as link_column;
```

(c) How many price book items there are. Note the number; step 4 expects the
same.

```sql
-- 0061 step 2 (c): cost items. Run this one alone.
select count(*) as cost_items from cost_items;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks
(several lines each, with `severity: 'NOTICE'` and a `message:` line). They
are not failures. The production-shaped rehearsal (a database built by main's
own migrations and main's own `rls/`, with the Supabase API roles) printed
these `message:` lines (on Supabase a line about a role may differ; any line
that ends `does not exist, skipping` or `already exists, skipping` is the
same kind):

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then FIVE new ones, once only (the first run creates the policies they
  drop): `message: 'policy "market_read" for relation "public.market_categories" does not exist, skipping',`
  and the same for `public.market_items`, `public.market_bulletins`,
  `public.market_price_observations` and `public.market_item_details`. A
  second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (62).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `51 tables, 51 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 10 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 51 declared table(s), every column present.`,
  then `indexes — 116 declared, all present.`, `constraints — 275 declared, all present.`,
  `functions — 44 declared, all present.`,
  `orphaned org rows — 44 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 13 found (13 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it. On an empty database
  the orphaned-rows line says it read 0 rows from organizations instead.)

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `cost_items` for more than 3 s. Re-run `db:migrate` a
  little later (rehearsed by a tester: a 10 s reader gave exactly these lines,
  everything rolled back, and the re-run applied 0061). The same two codes
  from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE P0001: 0061 needs PostgreSQL 12 or later ...`:
  the server is too old for this migration. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Locks.** `db:migrate` runs 0061 as ONE transaction. The five new tables
are created empty. On `cost_items` it takes ACCESS EXCLUSIVE for the new
column (metadata only), the NOT VALID foreign key, the validation (every row
is NULL, so it checks nothing) and one index build, all held until the commit.
A tester measured about 357 ms at 1,000,000 cost items (linear, so a few ms at
pilot size), and 0 app errors under load. `db:apply-rls` adds one policy file
with five tables, the 5 x 3 s = 15 s worst case of the rule above.

**4. Read-only, after: expected results.** Again each block ON ITS OWN.

(a) `migrations` 62 and `newest` 1792248953024 (0061's journal stamp).

```sql
-- 0061 step 4 (a): migrations recorded now. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) Step 2 (b) again, as its own block. Now `cost_item_units` is
`sqm,linear_meter,pcs,lump_sum,day,kg,ton,liter,cbm,roll`, `market_relations`
21, `market_types` 10 and `link_column` 1 (`server_ok` still true).

(c) 5 rows, one per market table, every one with `rls` true, `forced` true,
`policies` 1, `app_select` true, `app_writes` false and `api_roles_read`
false.

```sql
-- 0061 step 4 (c): the market tables' RLS and grants. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('metra_app', c.oid, 'select') as app_select,
       has_table_privilege('metra_app', c.oid, 'insert')
         or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete') as app_writes,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('market_categories', 'market_items', 'market_bulletins', 'market_price_observations', 'market_item_details')
order by 1;
```

(d) `cost_items` the same number as step 2 (c), and `linked` 0.

```sql
-- 0061 step 4 (d): cost items, none linked yet. Run this one alone.
select count(*) as cost_items, count(market_item_id) as linked from cost_items;
```

**5. Afterwards: merge, smoke test, return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Tell the lead the database step is done; the lead merges the branch and
   the Deploy workflow deploys it.
3. Smoke test on your own studio, with the log open (from
   `C:\Users\HP\merta-main\apps\web`: `npx wrangler tail metra-web`): open the
   price book, open "New item" and check the unit list now ends with kg, ton,
   liter, m³ and roll, then cancel without saving (see *Rolling back*: the
   first saved item in a new unit sets a floor). Expected: the page loads, and
   the log shows no `42703` and no `42501`.
4. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(1) The code** (a price book page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER). Once a
studio has saved an item in a new unit, read *Rolling back* first.

**(2) The schema, only if the market price book is abandoned.** Roll the code
back FIRST (1): a Worker with this code reads `cost_items.market_item_id` and
fails with 42703 the moment it is gone. Then run this ONE block, which drops
everything 0061 created except the five `cost_item_unit` labels (they cannot be
dropped and stay harmless). Rehearsed: step 2 (b) then reads
`market_relations`, `market_types` and `link_column` 0 again. Then tell the
lead: `60-market.sql` leaves the manifest and the market grant leaves
`roles.sql` in the same revert, or the next `db:apply-rls` fails on the
missing tables. 0061 stays recorded in `drizzle.__drizzle_migrations`; the
feature comes back only with a new migration.

```sql
-- 0061 undo (2): the market price book schema, as ONE transaction.
begin;
drop index if exists public.cost_items_org_market_item_idx;
alter table public.cost_items drop constraint if exists cost_items_market_item_id_market_items_id_fk;
alter table public.cost_items drop column if exists market_item_id;
drop table if exists public.market_item_details, public.market_price_observations, public.market_bulletins, public.market_items, public.market_categories;
drop type if exists public.market_observation_status, public.market_item_status, public.market_unit, public.market_bulletin_status, public.market_publisher;
commit;
```
