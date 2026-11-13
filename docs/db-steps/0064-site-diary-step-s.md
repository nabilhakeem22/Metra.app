# Site diary DB step S (0064, Stage 3 site app): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

The site engineer app (Stage 3) has ONE database step, and this is it:
migration `0064_site_diary.sql` plus `db:apply-rls` (three new files under
`rls/`, one new function beside its sibling in `functions/00-org-context.sql`,
one new trigger beside the `projects` policy in `policies/10-catalogue.sql`,
and new grants in `rls/roles.sql`). It is validated on branch
`validate/site-s2-schema`. Nothing in the app uses the new tables yet: the
first code that writes them is PR S3 (assignments) and PR S4 (check-in).

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs 0064:** the project page and the API's project reads
  select every column of a project, so they now name the five site pin
  columns, and new code on a database without 0064 fails them with 42703.
  (The API's project shape lists its fields one by one, so the pin never
  reaches an API key.)
- **The current Worker is safe on the 0064 database:** 0064 only ADDS (five
  empty columns on `projects`, one unique key on `contracts`, one text check
  function, seven new empty tables), and this `db:apply-rls` changes NO
  existing policy, function or grant. It adds ONE trigger to an existing
  table, `projects`: it watches the five new pin columns only, which the
  current code never writes, so it never fires for it. Rehearsed: a catalogue
  fingerprint of every policy, function, trigger and table grant was identical
  before and after step 3, except for the 51 new objects; and the
  current `main`'s own isolation gate and action tests passed on the 0064
  database, but for two tests that only count schema objects (see
  *Rehearsed* at the end).
- **No client and no studio sees anything new** until PR S4 ships: the tables
  are empty and nothing reads them.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `projects` | five new empty columns, the SITE PIN (`site_lat`, `site_lng`, `site_radius_m`, `site_pin_set_by`, `site_pin_set_at`), and two CHECKs: all five set or none, and the point and a 30 to 2000 m radius in range (added NOT VALID, then validated: every existing row has all five empty). In `db:apply-rls`, one trigger: only an owner, admin or project manager sets, moves or clears a pin; an assigned site engineer only sets a missing one |
| `contracts` | one unique key `(org_id, project_id, id)`, so a material delivery can only name a contract of its own project |
| five new enum types | `site_location_status`, `site_presence`, `site_photo_source`, `site_photo_status`, `site_note_kind` |
| one new function | `text_has_visible_character`: a delivery's description and a note's body must hold a visible character (an entry made only of invisible marks is refused) |
| seven new tables | `project_assignments`, `site_location_consents`, `site_devices`, `site_visits`, `site_photos`, `site_material_receipts`, `site_notes`: per studio (`org_id`), empty, and with RLS enabled and forced from the moment they exist (no policy yet, so nobody reads or writes them until step 3's `db:apply-rls`). A photo, a delivery and a note can only name a visit of their own project, and a delivery only a photo of its own project (3-column foreign keys). A photo stores no storage key: its keys are derived from its studio, project and id |
| `rls/policies/70-site.sql` | the seven tables: RLS enabled and forced, one `org_isolation` policy each, plus FIFTEEN restrictive policies: a site engineer writes and updates diary rows only on a project he is assigned to, always in his own name, and accountants, viewers and the client role write nothing; only an owner, admin or project manager assigns or revokes; a location consent is recorded or withdrawn only by its own person; a phone registers only itself, and a member sees and revokes only his own phones (a manager every phone). Eight guard triggers: a diary row is evidence (only its void, check-out, publication or coordinate purge may change, a voided row is frozen whole, nothing is ever deleted), only a manager publishes or changes what the client sees, a site engineer voids, checks out and marks stored only his own entries, a new row is checked as strictly as a change (nothing is inserted already published, stored, shown or voided), a visit's date is the Cairo day of its check-in, a revoke is final, and who an assignment or a phone is about never changes |
| `rls/functions/80-site.sql`, `85-site-portal.sql` | the two checks the restrictive policies call (may this person write on this project; does this person manage the studio), the "own row or a manager" rule, the photo storage key, the guards, and the client's published site updates by share token (published visits and the photos the studio chose only; never a location, a person, a note or a delivery) |
| `rls/functions/00-org-context.sql` | ADDS `app_current_user_orgs_for_session` beside `app_current_user_orgs` (which is unchanged): the same list, minus a studio where this phone was revoked (used from PR S8) |
| `rls/roles.sql` | `metra_app`: read, insert and update on the seven tables, never delete, each written `revoke all`, then the exact grant. The four new definer functions, and the "own row or a manager" rule, are callable by `metra_app` only |

**1. Put the site diary schema code in the production checkout.** This step
adds no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/site-s2-schema
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 992bca1e HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (992bca1e)
git diff --stat 0f9cb2db origin/main -- packages/db    # MUST print nothing: main's database code is still the one undo (0) restores
```

Two STOPs, tell the lead in either case:

- The first diff lists any file other than `docs/DEPLOY.md`: the code is not
  the code that was rehearsed.
- The second diff prints anything: someone changed the database code on
  `main` after this branch was cut, so undo (0) would not restore it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 64 and `newest` 1792363603266 (0063's journal stamp).

```sql
-- Site diary step S 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything
else means part of the site diary is already in this database: do not run
step 3, tell the lead.

```sql
-- Site diary step S 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name like 'site\_%') as pin_columns,
  (select count(*) from pg_constraint where conname = 'contracts_org_project_id_unique') as contract_project_key,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')) as site_tables,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname in ('site_location_status', 'site_presence', 'site_photo_source', 'site_photo_status', 'site_note_kind')) as site_types,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('text_has_visible_character', 'app_may_write_site_project', 'app_may_manage_site_project', 'app_is_self_or_site_manager', 'site_photo_object_key', 'app_current_user_orgs_for_session', 'app_delivery_site_updates_by_token', 'enforce_site_entry_guard', 'enforce_site_photo_state', 'enforce_site_visit_guard', 'enforce_site_visit_date', 'enforce_site_revoke_final', 'enforce_site_pin_writer')) as site_functions,
  (select count(*) from pg_trigger where tgname = 'trg_projects_site_pin_writer') as pin_trigger;
```

(c) The sizes the migration works on. Note the two numbers; step 4 (e)
expects the same. They set how long the migration holds `projects` and
`contracts` (see *Locks*).

```sql
-- Site diary step S 2 (c): the sizes the migration works on. Run this one alone.
select (select count(*) from public.projects) as projects,
       (select count(*) from public.contracts) as contracts;
```

(d) Expect `policies` 58 and `restrictive` 0. Step 4 (d) expects 80 and 15.

```sql
-- Site diary step S 2 (d): policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(e) The database size. Write the number down: it goes in the release note,
and step 4 (h) reads it again.

```sql
-- Site diary step S 2 (e): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line. The production-shaped rehearsal (a database built by the
0063 code, 5,002 projects, 5,002 contracts and 50,002 contract lines in 22 studios on it, then this branch)
printed exactly these; on Supabase the line about a role may differ, and any
line that ends `does not exist, skipping` or `already exists, skipping` is
the same kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then ONE new one, once only, for the pin trigger:
  `message: 'trigger "trg_projects_site_pin_writer" for relation "public.projects" does not exist, skipping',`
  then TWENTY-TWO new ones, once only, one per new policy:
  `message: 'policy "org_isolation" for relation "public.project_assignments" does not exist, skipping',`
  and the same for `site_managers_insert` and `site_managers_update` on
  `public.project_assignments`; then `org_isolation`,
  `site_consent_self_insert` and `site_consent_self_update` on
  `public.site_location_consents`; then `org_isolation`,
  `site_device_self_insert`, `site_device_self_or_manager_select` and
  `site_device_self_or_manager_update` on `public.site_devices`; then
  `org_isolation`, `site_write_assigned` and
  `site_update_assigned` on `public.site_visits`, `public.site_photos`,
  `public.site_material_receipts` and `public.site_notes`, in that order;
  then EIGHT new ones, once only, one per new trigger:
  `message: 'trigger "trg_project_assignments_revoke_final" for relation "public.project_assignments" does not exist, skipping',`
  and the same for `trg_site_devices_revoke_final` (`public.site_devices`),
  `trg_site_visits_guard` and `trg_site_visits_date` (`public.site_visits`),
  `trg_site_photos_guard` and `trg_site_photos_state` (`public.site_photos`),
  `trg_site_material_receipts_guard` (`public.site_material_receipts`) and
  `trg_site_notes_guard` (`public.site_notes`).
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (65).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `65 tables, 80 policies, 27 triggers, 59 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `— design_engagements update narrowed to 19 columns with no table-level update, and 23 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list naming a policy the
  manifest does not declare, or a TRUNCATE, REFERENCES or TRIGGER grant, it
  exits 1: something was added by hand. Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 65 declared table(s), every column present.`,
  then `assert-schema-applied: indexes — 147 declared, all present.`,
  `assert-schema-applied: constraints — 399 declared, all present.`,
  `assert-schema-applied: functions — 59 declared, all present.`,
  `assert-schema-applied: orphaned org rows — 57 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `assert-schema-applied: composite set-null FKs — 16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it.)

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/00-core.sql rolled back with SQLSTATE 40P01 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/00-core.sql ... (attempt 2 of 3)` is NOT a
failure: that one file rolled back whole and is being applied again (3
attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0064: could not take every lock within 3 s (stopped at public.projects:ACCESS EXCLUSIVE)`
  (the table named may be `contracts`, `contract_lines` or `organizations`)
  then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its four locks ALL OR NONE (see *Locks*): it tries for
  all four at once, lets go of every one it got when one table is busy, and
  tries again, for 3 s in all. This line means the named table never came
  free in those 3 s: a long query or transaction held it, or studio requests
  kept it busy without a gap. It held nothing while it tried, so no studio
  request waited on it. Re-run `db:migrate` a little later. Rehearsed: a
  reader holding `projects` for 10 s gave exactly these two lines, `migrations`
  stayed 64, step 2 (b) still read all 0, and the re-run after the reader
  finished applied 0064. A `SQLSTATE 40P01: deadlock detected` from
  `db:migrate` no longer comes from these locks (rehearsed: 0 in 60
  migration runs, 50 of them beside studio traffic); if one appears anyway, the same two lines and
  the same advice hold.
- `apply-rls failed: SQLSTATE 40P01: deadlock detected` (or
  `SQLSTATE 55P03: canceling statement due to lock timeout`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row. The cause is NOT a
  broken database, and usually not a long transaction either: a 40P01, almost
  always at `Applying policies/00-core.sql ...`, is ORDINARY studio traffic
  (that file locks the studios table and then the members table, and every
  studio save takes the two the other way round; a studio member may see one
  save fail and try it again); a 55P03 is a studio transaction or report that
  held a table for more than 3 s. **Run `npm run db:apply-rls` again, and keep
  re-running it until it exits 0** (wait a minute between runs; it is safe,
  every statement is idempotent). Until it does, the seven new tables are
  forced but may have no policy yet: `metra_app` reads and writes NOTHING in
  them (0064 itself forced their RLS), they are empty, and nothing reads
  them; still, re-run the same evening. Rehearsed: see *Rehearsed* below.
- `Migration failed: SQLSTATE 42701: column "site_lat" of relation "projects" already exists`
  (or `42P07` or `42710`, "already exists", for a table, a type or a
  function) then
  `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of the site diary is already in this database, which step 2 (b) would
  have shown. Nothing changed; tell the lead.
- `Migration failed: SQLSTATE P0001: 0064: ... composite set-null foreign
  key(s) ...`: a foreign key the 0052 rule forbids. Nothing changed; tell the
  lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0064 only when the whole batch
commits, so after any failure a re-run starts again from 0063; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0064 as ONE transaction. It first takes every
lock it needs, ALL OR NONE, within ONE 3 s budget for all its attempts
together: ACCESS EXCLUSIVE (no reads, no writes) on `projects` and
`contracts`, and SHARE ROW EXCLUSIVE (reads go on, writes wait) on
`contract_lines` and `organizations`. Each attempt asks for all four without
waiting; if one is busy it lets go of the ones it got, sleeps 10 to 40 ms and
tries again, so it never holds `projects` while it waits for `contracts` (that
wait, against the contracts list, which reads `contracts` and then
`projects`, is what could deadlock before). Then, holding them, it adds five
empty columns to `projects` (no rewrite), checks the two new CHECKs over every
project (one scan each), builds one unique index over `contracts`, and creates
the seven empty tables. `projects` is read by nearly every studio page, so
those pages wait for this window, briefly: the whole migration took 120 to 139 ms at 5,002 projects and 5,002 contracts on a quiet local server and 150 to 390 ms beside studio traffic, and through a real `db:migrate` beside studio traffic the slowest studio request took 318 ms, with 0 errors. Supabase is slower than a local server (the window measured there earlier was 0.5 to 1.9 s), so a studio page can wait about 1 s; no studio request fails because of it. Under very dense traffic (about 3,000 requests a second in the rehearsal, far above any pilot) the all-or-none attempt kept losing and ended in the 55P03 above: the re-run case. Step 2 (c) gives the
sizes to compare with; pilot volumes are far below 5,000.
`design_engagements` (the table every client act locks) is not touched.
Estimates from a local server, not a production measurement. `db:apply-rls`
adds one policy file with seven NEW tables (nothing waits on them) and one
trigger in `policies/10-catalogue.sql`, which already locks `projects` for its
policy; every existing file runs exactly as it always does (the 11 x 3 s =
33 s worst case of `10-catalogue.sql` is unchanged), and a file that loses a
lock race is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) `migrations` 65 and `newest` 1792880198159 (0064's journal stamp): step 2
(a) again.

(b) Step 2 (b) again: now `pin_columns` 5, `contract_project_key` 1,
`site_tables` 7, `site_types` 5, `site_functions` 13 and `pin_trigger` 1.

(c) 7 rows, every one with `rls` true, `forced` true, `app_privileges`
exactly `S,I,U` and `api_roles_read` false; `policies` 4 and `triggers` 1 on
`site_devices`; `policies` 3 and `triggers` 0 on `site_location_consents`;
`policies` 3 and `triggers` 1 on `project_assignments`,
`site_material_receipts` and `site_notes`; `policies` 3 and `triggers` 2 on
`site_photos` and `site_visits`.

```sql
-- Site diary step S 4 (c): the seven tables' RLS, grants and triggers. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       coalesce((select bool_or(has_table_privilege(r.oid, c.oid, 'select')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated')), false) as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')
order by 1;
```

(d) Step 2 (d) again: now `policies` 80 and `restrictive` 15.

(e) Step 2 (c) again: the same two numbers as before.

(f) The four new definer functions: 4 rows, every one with `definer` true,
`app_execute` true, `public_execute` false and `api_roles_execute` false.

```sql
-- Site diary step S 4 (f): who may call the four new definer functions. Run this one alone.
select p.proname, p.prosecdef as definer,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_current_user_orgs_for_session', 'app_delivery_site_updates_by_token', 'app_may_manage_site_project', 'app_may_write_site_project')
order by 1;
```

(g) Nothing is written yet: `site_rows` 0 and `pinned_projects` 0.

```sql
-- Site diary step S 4 (g): no site row exists yet, and no project has a pin. Run this one alone.
select (select count(*) from public.project_assignments) + (select count(*) from public.site_location_consents)
     + (select count(*) from public.site_devices) + (select count(*) from public.site_visits)
     + (select count(*) from public.site_photos) + (select count(*) from public.site_material_receipts)
     + (select count(*) from public.site_notes) as site_rows,
       (select count(*) from public.projects where site_lat is not null) as pinned_projects;
```

(h) Step 2 (e) again: about the same size as before (the new tables are
empty; the rehearsal grew by about 1 MB, 50 MB to 51 MB, for the new unique key on `contracts`). Put the number in the
release note. **The size to watch:** Supabase Free stops writes at 500 MB, and
the site diary is the first thing that will fill it (about 0.19 MB a month
per active site, measured: see *Database size* below). **If this reads 400 MB
or more, tell the lead before PR S4 ships**; that 400 MB alarm is a later PR's
job, this line is the check until then.

**Stop and do not go on** if any output in steps 3 or 4 differs from what
is written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still
runs the current `main`; this checks it against the database step 3 just
changed. About ten minutes, in your own studio only. Open the log first, in
a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open the dashboard, **Projects** and one project (each of
   its tabs), Clients and one client, then **Contracts** in the sidebar and
   one contract. Expected: every page loads and shows your data as before. A
   list that is suddenly EMPTY counts as a failure too.
2. **One harmless save.** Pick one of your own clients, open its **Details**
   tab, add a word at the end of **Notes** (for example `check`), press
   **Save details**: expected `Details saved`. Then delete that word, press
   **Save details** again: expected `Details saved`. In Arabic the same
   labels read التفاصيل, ملاحظات, حفظ التفاصيل and تم حفظ التفاصيل. Reload the page: Notes
   read exactly as before.

Expected in the log for all of the above: no `42501`, no `42703`, no
`MT100`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 (1) again, now on the new code. Expected: every page loads, and the log
   shows no `42703`, no `42501` and no `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The policies and the pin trigger, before the merge** (step 5 fails, or
before the merge the log shows a `42501`). Step 3 changed no existing policy,
function or grant, and added one trigger on `projects` that the current code
never fires (rehearsed: identical catalogues otherwise), so this is a
precaution, not a repair. It takes the twenty-two new site policies away (the
seven tables stay forced, so with no policy `metra_app` reads and writes
nothing in them), drops the pin trigger, and runs the PREVIOUS `main`'s own
`db:apply-rls` (the code at `0f9cb2db`, the one the site runs now), which
re-applies every existing object exactly as it was before step 3. The
policies must go first: that code does not declare them, and its own check
refuses a policy it does not declare. It leaves 0064 itself alone: the new
columns, the seven tables with their grants and guard triggers, and the new
functions stay as step 3 made them (the current site never touches them).
Use it only while the site still runs the code from before the merge: if the
new code is already deployed, undo (1) the code first, then this.

First, in the Supabase SQL editor, on its own. Expected: one row,
`site_policies` 0 and `pin_trigger` 0.

```sql
-- Site diary step S undo (0): take the twenty-two site policies and the pin trigger away so the
-- previous main's apply-rls (which does not declare them) exits 0. Run this one alone.
begin;
drop policy if exists org_isolation on public.project_assignments;
drop policy if exists site_managers_insert on public.project_assignments;
drop policy if exists site_managers_update on public.project_assignments;
drop policy if exists org_isolation on public.site_location_consents;
drop policy if exists site_consent_self_insert on public.site_location_consents;
drop policy if exists site_consent_self_update on public.site_location_consents;
drop policy if exists org_isolation on public.site_devices;
drop policy if exists site_device_self_insert on public.site_devices;
drop policy if exists site_device_self_or_manager_select on public.site_devices;
drop policy if exists site_device_self_or_manager_update on public.site_devices;
drop policy if exists org_isolation on public.site_visits;
drop policy if exists site_write_assigned on public.site_visits;
drop policy if exists site_update_assigned on public.site_visits;
drop policy if exists org_isolation on public.site_photos;
drop policy if exists site_write_assigned on public.site_photos;
drop policy if exists site_update_assigned on public.site_photos;
drop policy if exists org_isolation on public.site_material_receipts;
drop policy if exists site_write_assigned on public.site_material_receipts;
drop policy if exists site_update_assigned on public.site_material_receipts;
drop policy if exists org_isolation on public.site_notes;
drop policy if exists site_write_assigned on public.site_notes;
drop policy if exists site_update_assigned on public.site_notes;
drop trigger if exists trg_projects_site_pin_writer on public.projects;
commit;
select (select count(*) from pg_policies
         where schemaname = 'public'
           and tablename in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')) as site_policies,
       (select count(*) from pg_trigger where tgname = 'trg_projects_site_pin_writer') as pin_trigger;
```

The checkout you switch to below does not contain this runbook, so first
save a copy and read the rest of undo (0) from that copy:

```powershell
cd C:\Users\HP\merta-main
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-site-s.md
git fetch origin
git switch --detach 0f9cb2db
git log --oneline -1    # 0f9cb2db fix(ui): draw combobox and picker popups in a body-level layer
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout: the previous code does not know
0064, and nothing else is needed. Expected:

- It exits 0. NOTICE blocks: only the FIRST FOUR of step 3, nothing about the
  seven new tables or the pin trigger.
- It ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `58 tables, 58 policies, 18 triggers, 47 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `— design_engagements update narrowed to 19 columns with no table-level update, and 16 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  The numbers are smaller than step 3's on purpose: the previous code counts
  only what it declares.
- A failure prints `apply-rls failed: ...` with the SQLSTATE, as in step 3.
  The previous code does not retry a lost lock race by itself: on 55P03 or
  40P01, run it again a little later, until it exits 0. A problem list naming
  a `site_` policy means the SQL block above was not run first: run it, then
  this again.

Then, read-only (each block ON ITS OWN): step 2 (d) again, `policies` 58 and
`restrictive` 0; step 4 (c) again, exactly as step 4 (c) expects except
`policies` 0 on all seven rows; step 4 (f) again, exactly as step 4 (f)
expects. Then step 5 again: everything works as it did before step 3. Put
the checkout back on main (step 6 (3)) and tell the lead what failed the
first time. Do not merge. If step 5 STILL fails after undo (0), this step
was not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` (0064 is still applied, so
`db:migrate` is not needed). Expected: the first four notices of step 3, then the pin trigger's and the twenty-two policy notices (the eight site trigger notices do not come back: those triggers were never removed) and the same two
verified lines; then step 4 (b) `pin_trigger` 1, step 4 (d) `policies` 80 and
`restrictive` 15, then step 5 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema, only if the site app is abandoned, and only while no site
row exists (step 4 (g) still 0 and 0).** Tell the lead first: it is a revert
of `rls/` and a new migration, never a hand edit here.

**Database size.** Measured on the rehearsal database: one year of the site
diary at the planned pilot scale (20 studios with 3 active sites each, 60
sites; per site per working day 1.5 visits, 10 photos, 3 deliveries and 2
notes; 264 working days), inserted with every trigger on, then vacuumed:

| Table | Rows a year | Bytes a row, indexes included | Size |
|---|---|---|---|
| `site_photos` (six indexes) | 158,400 | 523 | 79 MB |
| `site_material_receipts` | 47,520 | 518 | 23 MB |
| `site_notes` | 31,680 | 684 | 21 MB |
| `site_visits` | 23,760 | 713 | 16 MB |
| the site diary | | | about 140 MB a year, 0.19 MB a month per active site |

That is a lower bound (an update leaves dead space until autovacuum reclaims
it). At five times that scale it is about 700 MB a year, about 58 MB a month.
From the about 225 MB the database held earlier, 400 MB is reached after about
15 months at the planned scale (about 3 months at five times it) and 500 MB
after about 24 months (about 5). Hence step 4 (h).

**Rehearsed** on a local Postgres 17 (UTF8) built by the 0063 code (`main`'s
database code, `0f9cb2db`), with 5,002 projects, 5,002 contracts and 50,002
contract lines in 22 studios on it, then this branch's code: every command and
read-only block above printed exactly the lines quoted, on the first run and on
the second (`db:migrate` found nothing pending; `db:apply-rls` printed only the
first four notices). A catalogue fingerprint (every policy, function body and
settings, trigger definition and table grant) was identical before and after
step 3 for every object that existed before it, and an md5 of every existing
project and contract row was unchanged. The lock races, on purpose:

- a reader holding `projects` for 10 s against `db:migrate`: the two 55P03
  lines after 5.2 s, `migrations` still 64, step 2 (b) still all 0, and the
  re-run after the reader finished applied 0064;
- a reader holding `site_notes` for 25 s against `db:apply-rls`: two retries,
  then the two `apply-rls failed:` lines after 17.2 s; in between, the seven
  tables were forced with no policy and an insert by `metra_app` was refused
  (42501); the re-run exited 0;
- the traffic runs below were measured on the code before the S2 re-check
  round; 0064 and the apply-rls retry are byte-identical since, and that round
  changed only the new site tables' policies and guards, which no studio
  request touches;
- 30 migration runs (rolled back) beside studio traffic at about 13 requests a
  second, the contracts list among them: 30 of 30 clean, 0 deadlocks, the
  slowest studio request 220 ms (the earlier one-lock-at-a-time version
  deadlocked in 3 to 10 % of such runs); 10 at about 520 requests a second: 10
  of 10, 0 deadlocks; 10 at about 3,000 a second: 9 ended in 55P03, 1 clean,
  0 deadlocks, 0 studio errors;
- a real `db:migrate` beside studio traffic: applied in 2.4 s, 0 studio errors,
  the slowest studio request 318 ms;
- six `db:apply-rls` runs beside about 830 studio writes a second: all six
  exited 0; five lost a race at `policies/00-core.sql` (40P01), and each landed
  on its retry; 24 of the studio writes were ended by the same deadlocks
  instead (a studio member would see one save fail), which is why step 3 asks
  for a quiet hour.

On that 0064 database the current `main`'s own cross-tenant isolation gate
passed (59 of 59), and its action tests passed 1,469 of 1,472 (one is a
todo): the other two only count schema objects (the set-null foreign keys and
the token functions in the database) and count the ones 0064 adds on any 0064
database. Undo (0) printed exactly the lines above and exited 0; the
fingerprint then matched the database before step 3 for every object the
previous `main` declares, plus the 28 objects of 0064 it keeps (thirteen
functions, the seven tables, the eight triggers on them), and matched step 3's
database minus the twenty-two policies and the pin trigger. Without the SQL
block first, the previous `main`'s `db:apply-rls` exits 1 and lists 22
problems, each a site policy "declared by NO rls/ file". This branch's
`db:apply-rls` afterwards printed the lines of *To go forward again* and gave
a database identical to the first run's.
