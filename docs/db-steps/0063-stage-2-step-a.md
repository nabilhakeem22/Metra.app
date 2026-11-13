# 0063 and Stage 2 DB step A (execution first release): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Stage 2 (contract from BOQ, payment requests, payments, costs, measurements)
has TWO database steps, and this is the first: migration
`0063_execution_first_release.sql` plus `db:apply-rls` (two new files under
`rls/`, the replaced contract and change-order client functions, and the
policy speed-up below). It is validated on branch
`validate/stage2-a2-schema`. The second step (the client "I paid" on the
delivery page) is apply-rls only, around Nov 18, with its own runbook.

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge: a few pages and one harmless save in your own
   studio. If it fails, undo (0) puts the previous policies back.
3. **Then, right after that check,** the lead merges the branch to `main` and
   the Deploy workflow deploys it, and you run the smoke test (step 6). Do not
   leave a gap (see the last reason).

Why this order, one sentence each:

- **The new code needs 0063:** the contract and change-order reads now name
  `source_boq_id`, `item_code`, `provisional` and `time_extension_days`, so
  new code on a database without 0063 fails every contract page with 42703.
- **The current Worker is safe on the 0063 database:** 0063 only ADDS
  (nullable columns, new tables nobody reads yet), and the replaced client
  functions only add keys. Rehearsed: the current app's own contract and
  change-order code, unchanged, reads, acknowledges and responds on the 0063
  database.
- **No client sees a change in what a contract says:** the contract link (/c)
  still shows every line of every section; it only carries more keys (the
  schedule, a digest of every line, the item codes). One visible difference:
  lines that share a sort order now always appear in the same order, by sort
  order and then by id, the order the studio page uses since PR B1 (before,
  ties came back in whatever order the database stored them). The lazy loading of long
  sections arrives with PR A3, and the snapshot is only cut to 50 lines per
  section in DB step B (Nov 18), once that page is live.
- **A signature or a change-order decision now also writes studio
  notifications,** for every contract, quote contracts included. This branch
  teaches the bell to show them ("The client signed contract C-2026-0007",
  "approved change order VO-..."). Until it is deployed, the current Worker
  shows them as an empty line (it renders an unknown notification as nothing,
  never as an error), which is why the merge follows step 5 at once.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `contracts` | `source_proposal_id` may be empty; new `source_boq_id` (the issued BOQ an execution contract comes from) with its same-org FK, one contract per BOQ, and the CHECK `contracts_one_source` (exactly one of the two is set; every existing contract has a proposal and no BOQ) |
| `contract_lines` | new `item_code` (empty) and `provisional` (false), one unique index `(org_id, contract_id, id)`, and a 3-column foreign key: a line's section is a section of its own contract (added NOT VALID, then validated over every existing line; step 2 (e) checks first) |
| `contract_sections` | one unique index `(org_id, contract_id, id)` |
| `variation_orders` | new `time_extension_days` (empty), CHECK 0 to 3650, and one unique index `(org_id, contract_id, id)` |
| three new enum types | `payment_request_kind`, `payment_request_status`, `cost_category` |
| six new tables | `contract_payment_milestones`, `payment_requests`, `contract_payments`, `contract_payment_claims`, `contract_cost_entries`, `contract_line_measurements` (the FINAL measured quantity per line at handover, ordered by an identity `seq`): per studio (`org_id`), empty. Every link to a line, a section, a request, a milestone or a change order is a 3-column foreign key, so it can only name a row of the SAME contract. Every money CHECK also refuses NaN; a cost description must hold a visible character |
| `rls/policies/35-execution.sql` | the six tables: RLS enabled and forced, one `org_isolation` policy each, and three triggers: the schedule freezes with its contract; a payment request can only go issued to void, never once paid; a payment fits its request (issued, and never more than its amount, under the request's row lock) |
| `rls/functions/35-execution.sql` | the payment request's frozen guard and the payment-fits guard |
| `enforce_contract_child_draft()` (`30-contracts-variations.sql`) | reads the parent contract `FOR SHARE`, so a schedule edit racing an issue waits for it and is refused, instead of landing in a sent contract |
| `rls/functions/30-contracts-variations.sql` | the contract link (/c) adds the payment schedule, a digest of every line, item codes, the provisional flag and the day and way a signed contract was signed (online or on paper), and still carries every line (a new function serves one section's lines 100 at a time, for PR A3's page, reading that section only); signing notifies owners, admins and project managers, and waits at most 4 s behind a studio save holding the contract (the client is then told to refresh and check, and nothing is signed later); the change-order link (/v) adds VAT, supervision and the extra days; a decision notifies the same three roles |
| every `rls/policies/*.sql` | **the policy speed-up:** each studio policy now reads the org context and the membership check ONCE per query instead of once per row (`(select ...)`). Same answer, about 40 times faster on a big contract (measured: 492.6 ms before, 11.4 ms after, on a 50,000-line contract). Applied by this same `db:apply-rls`; nothing extra to run |
| `rls/roles.sql` | `metra_app`: full access to the schedule; requests, claims and costs without delete; payments insert and read only; measurements read, and insert on every column but `seq`. Each written `revoke all`, then the exact grant. The new functions are callable by `metra_app` only |

**1. Put the Stage 2 schema code in the production checkout.** This step adds
no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/stage2-a2-schema
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat b43919ab HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (b43919ab)
git diff --stat b415d66b origin/main -- packages/db    # MUST print nothing: main's database code is still the one undo (0) restores
```

Two STOPs, tell the lead in either case:

- The first diff lists any file other than `docs/DEPLOY.md`: the code is not
  the code that was rehearsed.
- The second diff prints anything: someone changed the database code on
  `main` after this branch was cut, so this branch's `db:apply-rls` would
  remove that change and undo (0) would not restore it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 63 and `newest` 1792272891040 (0062's journal stamp).

```sql
-- 0063 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything
else means part of Stage 2 is already in this database (or, for
`contracts_without_proposal`, a contract the CHECK would refuse): do not run
step 3, tell the lead.

```sql
-- 0063 step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'source_boq_id') as boq_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'variation_orders' and column_name = 'time_extension_days') as extension_column,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')) as execution_tables,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname in ('payment_request_kind', 'payment_request_status', 'cost_category')) as execution_types,
  (select count(*) from public.contracts where source_proposal_id is null) as contracts_without_proposal;
```

(c) The sizes the migration works on. Note the five numbers; step 4 (e)
expects the same. `most_lines_in_one_contract` and `contract_lines` set how
long the migration holds the contract tables (see *Locks*).

```sql
-- 0063 step 2 (c): the contract tables' sizes. Run this one alone.
select (select count(*) from public.contracts) as contracts,
       (select count(*) from public.contract_sections) as contract_sections,
       (select count(*) from public.contract_lines) as contract_lines,
       (select coalesce(max(n), 0) from (select count(*) as n from public.contract_lines group by contract_id) per_contract) as most_lines_in_one_contract,
       (select count(*) from public.variation_orders) as variation_orders;
```

(d) How many studio policies still read the membership check once per row.
Expect `policies` 52 and `per_row` 46 (the six market policies are already
in the once-per-query form). Note them; step 4 (d) expects 58 and 0.

```sql
-- 0063 step 2 (d): policies that read the membership check per row. Run this one alone.
select count(*) as policies,
       count(*) filter (where regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
         '\(\s*SELECT app_is_current_org_member\(\) AS app_is_current_org_member\)', '', 'g')
         ~ 'app_is_current_org_member\(\)') as per_row
from pg_policies where schemaname = 'public';
```

(e) **THE LINE CHECK: 0, or STOP.** 0063 adds a foreign key saying a contract
line's section belongs to the line's own contract, and validates it over
every existing line. Lines are only ever written together with their section,
so expect 0. Anything else would make step 3 fail with 23503 (and change
nothing): do not run step 3, tell the lead the number.

```sql
-- 0063 step 2 (e): contract lines whose section is another contract's. Run this one alone.
select count(*) as lines_in_another_contracts_section
from public.contract_lines l
join public.contract_sections s on s.id = l.section_id
where s.contract_id <> l.contract_id or s.org_id <> l.org_id;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line. The production-shaped rehearsal (a database built by the
0062 code, 200 contracts, 1,000,000 contract lines and 400 change orders on it,
then this branch) printed these, and on Supabase a line about a role may
differ; any line that ends `does not exist, skipping` or `already exists,
skipping` is the same kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then SIX new ones, once only: `message: 'policy "org_isolation" for relation "public.contract_payment_milestones" does not exist, skipping',`
  and the same for `public.payment_requests`, `public.contract_payments`,
  `public.contract_payment_claims`, `public.contract_cost_entries` and
  `public.contract_line_measurements`, then THREE new ones, once only:
  `message: 'trigger "trg_contract_payment_milestones_parent_draft" for relation "public.contract_payment_milestones" does not exist, skipping',`,
  `message: 'trigger "trg_payment_requests_frozen" for relation "public.payment_requests" does not exist, skipping',`
  and `message: 'trigger "trg_contract_payments_fits" for relation "public.contract_payments" does not exist, skipping',`.
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (64).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `58 tables, 58 policies, 18 triggers, 47 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 16 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list naming a policy the
  manifest does not declare, or a TRUNCATE, REFERENCES or TRIGGER grant, it
  exits 1: something was added by hand. Do not merge; tell the lead.
  The policy speed-up prints nothing of its own: the same 58 policies are
  re-created in their new form (step 4 (d) shows it).
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 58 declared table(s), every column present.`,
  then `indexes — 133 declared, all present.`, `constraints — 340 declared, all present.`,
  `functions — 47 declared, all present.`,
  `orphaned org rows — 50 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 15 found (15 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it.)

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  Long queries held the tables 0063 needs for more than 3 s in total (see
  *Locks*). Re-run `db:migrate` a little later. Rehearsed: a reader holding
  `contract_lines` for 10 s gave exactly these two lines after 3 s,
  `migrations` stayed 63, no column was added, and the re-run after the reader
  finished applied 0063. The same two
  codes from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE 23514: ... "contracts_one_source"`: a contract
  without a proposal, which step 2 (b) would have shown. Nothing changed; tell
  the lead.
- `Migration failed: SQLSTATE 23503: ... "contract_lines_section_same_contract_fk"`:
  a line in another contract's section, which step 2 (e) would have shown.
  Nothing changed; tell the lead.
- `Migration failed: SQLSTATE P0001: 0063: ... composite set-null foreign
  key(s) ...`: a foreign key the 0052 rule forbids. Nothing changed; tell the
  lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0063 only when the whole batch
commits, so after any failure a re-run starts again from 0062; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0063 as ONE transaction. It first takes every
lock it needs, in one fixed order, within ONE 3 s budget for all of them
together: ACCESS EXCLUSIVE (no reads, no writes) on `contracts`,
`contract_sections`, `contract_lines` and `variation_orders`, then SHARE ROW
EXCLUSIVE (reads go on, writes wait) on `boqs`, `cost_items` and
`organizations`. 3 s is the most it waits in total, not per table: if busy
tables one after the other use the budget up, it stops with the 55P03 lines
above and nothing changes. So contract pages wait at most about 3 s for the
lock waits plus the migration's own work, then it commits and releases
everything. Rehearsed: two readers, one holding `contract_lines` for 2 s and
one holding `variation_orders` for 8 s, made it give up with 55P03 after 3 s
in total; an app reader of a contract (5 s lock wait) waited at most 3,015 ms
and saw 0 errors. Without blockers the work is about 0.3 s at 100,000
contract lines and about 2.1 s at 1,000,000 (the largest steps are the new
unique index and the validation of the new section foreign key on
`contract_lines`, both linear in its rows); through a real `db:migrate` on
1,000,000 lines that app reader waited at most 2,111 ms and saw 0 errors. Step 2 (c) gives the size to
compare with. `design_engagements` (the table every client act locks) is not
touched. Pilot volumes are far below 100,000 lines; run it at a quiet moment
anyway. Estimates from a local server, not a production measurement.
`db:apply-rls` adds one policy file with six NEW tables (nothing waits on
them), and every existing policy file runs as it always does (the 11 x 3 s =
33 s worst case of `10-catalogue.sql` is unchanged).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) `migrations` 64 and `newest` 1792363603266 (0063's journal stamp): step 2
(a) again.

(b) Step 2 (b) again: now `boq_column` 1, `extension_column` 1,
`execution_tables` 6, `execution_types` 3 and `contracts_without_proposal` 0.

(c) 6 rows, every one with `rls` true, `forced` true, `policies` 1 and
`api_roles_read` false; `app_privileges` exactly:
`contract_cost_entries` S,I,U; `contract_line_measurements` S (its INSERT is
per column, see (g)); `contract_payment_claims` S,I,U;
`contract_payment_milestones` S,I,U,D; `contract_payments` S,I;
`payment_requests` S,I,U. And `triggers` 1 on `contract_payment_milestones`,
`contract_payments` and `payment_requests`, 0 on the others.

```sql
-- 0063 step 4 (c): the six tables' RLS, grants and triggers. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')
order by 1;
```

(d) Step 2 (d) again: now `policies` 58 and `per_row` 0.

(e) Step 2 (c) again: the same five numbers as before.

(f) The client functions and the payment-fits guard: 6 rows, every one with
`app_execute` true and `public_execute` false and `api_roles_execute` false.
(The guard runs as the caller, under RLS, so it can say nothing about another
studio's request; it is locked down anyway, like every function here.)

```sql
-- 0063 step 4 (f): who may call the contract and change-order client functions. Run this one alone.
select p.proname,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_contract_by_token', 'app_contract_section_lines_by_token', 'app_contract_ack_by_token',
                    'app_variation_by_token', 'app_variation_respond_by_token', 'enforce_contract_payment_fits')
order by 1;
```

(g) Who may write a measurement's recording order: 12 rows, `insertable`
true on every column except `seq`, which is false (nobody but the database
chooses the order of the final measured quantities).

```sql
-- 0063 step 4 (g): which measurement columns metra_app may insert. Run this one alone.
select a.attname as column_name,
       has_column_privilege('metra_app', a.attrelid, a.attnum, 'insert') as insertable
from pg_attribute a
where a.attrelid = 'public.contract_line_measurements'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attnum;
```

**Stop and do not go on** if any output in steps 3 or 4 differs from what
is written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still
runs the current `main`; this checks it against the policies step 3 just
replaced. About ten minutes, in your own studio only. Open the log first, in
a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open the dashboard, Clients and one client, Projects and
   one project, then **Contracts** in the sidebar and one contract (and, on
   that contract's **Variation register** tab, سجل أوامر التغيير, one change
   order if it has any), and the price book. Expected: every page
   loads and shows your data as before. A list that is suddenly EMPTY counts
   as a failure too: a policy that refuses hides rows, it does not show an
   error.
2. **One harmless save.** Pick one of your own clients, open its **Details**
   tab, add a word at the end of **Notes** (for example `check`), press
   **Save details**: expected `Details saved`. Then delete that word, press
   **Save details** again: expected `Details saved`. In Arabic the same
   labels read التفاصيل, ملاحظات, حفظ التفاصيل and تم حفظ التفاصيل. Reload the page: Notes
   read exactly as before. (Notes are private to your studio and never shown
   to the client; your audit log records the two edits, nothing else
   changes.)
3. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`) or a change-order link (`/v/...`)
   you sent to yourself, open each: it shows the document as before. Only
   look: do not sign, acknowledge, approve or reject anything. No test link:
   skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42703`, no
`mutateInOrg failed`.

**If anything in step 5 fails** (a page errors or shows a list empty that was
not, the save does not say `Details saved`, or the log shows one of those
three): do not merge. Run undo (0) below now, then tell the lead what you
saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 (1) again, now on the new code. Expected: every page loads, and the log
   shows no `42703`, no `42501` and no `mutateInOrg failed`. If a test client
   contract link of yours exists, open it: it shows the contract as before.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The policies, before the merge** (step 5 fails, or before the merge the
log shows a `42501` or a studio reports a broken page). This is the PREVIOUS
`main`'s own `db:apply-rls` (the code at `b415d66b`, the one the site runs
now), run on the 0063 database. It puts back, exactly as they were before
step 3: every studio policy (in the once-per-row form), the contract and
change-order client functions (the /c read and acknowledgement, the /v read
and response; a signature stops writing studio notifications again) and the
child-draft guard. It leaves 0063 itself alone: the new columns, the six new
tables with their RLS, policies, grants and triggers, and the three new
functions stay exactly as step 3 made them (the current site never touches
them). Use it only while the site still runs the code from before the merge:
if the new code is already deployed, undo (1) the code first, then this.

The checkout you switch to below does not contain this runbook, so first
save a copy and read the rest of undo (0) from that copy:

```powershell
cd C:\Users\HP\merta-main
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-0063.md
git fetch origin
git switch --detach b415d66b
git log --oneline -1    # b415d66b merge: main (A1 money engine) into the bounded contract pages
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout: the previous code does not know
0063, and nothing else is needed. Expected:

- It exits 0. NOTICE blocks: only the FIRST FOUR of step 3 (the two `does not
  exist, skipping` functions, `role "postgres" has already been granted
  membership ...` and `policy "self_memberships" ... does not exist,
  skipping`), nothing about the six new tables.
- It ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `52 tables, 52 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 11 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
  The numbers are smaller than step 3's on purpose: the previous code counts
  only what it declares, and the six new tables are not in its list (it does
  not touch them).
- A failure prints `apply-rls failed: ...` with the SQLSTATE, as in step 3,
  and the same advice holds (55P03 or 40P01: run it again a little later).

Then, read-only (Supabase SQL editor, each block ON ITS OWN):

- Step 2 (d) again: `policies` 58 and `per_row` 46. The 46 studio policies
  are back in the per-row form; the six market policies and the six new ones
  were written in the once-per-query form and stay so.
- Step 4 (c) again: exactly what step 4 (c) expects (the six new tables are
  untouched).
- Step 4 (f) again: exactly the 6 rows step 4 (f) expects.

Then step 5 again: everything works as it did before step 3. Put the
checkout back on main (step 6 (3)) and tell the lead what failed the first
time. Do not merge. If step 5 STILL fails after undo (0), the policies were
not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` (0063 is still applied, so
`db:migrate` is not needed). Expected: the step 3 lines of a SECOND run (the
first four notices only, and the same two verified lines), then step 4 (d)
`policies` 58 and `per_row` 0, then step 5 and on.

Rehearsed on a local database built by the 0062 code: 0063 and this branch's
`db:apply-rls`, then the previous `main`'s `db:apply-rls` printed exactly the
lines above and exited 0. A catalogue comparison then found every policy,
function, trigger and grant of the previous `main` identical to the database
before step 3, and the 0063 objects identical to after step 3. The previous
`main`'s own action tests (contracts, change orders, clients, projects, the
price book and the rest: 1,139 of 1,141; the other two only count schema
objects, and count the ones 0063 adds on any 0063 database) and its
cross-tenant isolation gate (58 of 58) passed on it. The same tests passed
before the undo too, on this branch's policies, which is what step 5 checks
on the live site.
This branch's `db:apply-rls` afterwards gave a database identical to the
first run's, and this branch's tests passed on it.

**(1) The code** (a contract page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema, only if Stage 2 is abandoned, and only while no execution
contract exists.** Tell the lead first: it is a revert of `rls/` and a new
migration, never a hand edit here. The policy speed-up is NOT undone by it
and needs no undo: it changes how often the same check runs, not what it
answers.
