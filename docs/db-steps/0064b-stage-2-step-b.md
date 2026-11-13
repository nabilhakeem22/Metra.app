# Stage 2 DB step B (the client "I paid" on the delivery page): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

The second Stage 2 database step. It is `db:apply-rls` ONLY: no migration, so
`db:migrate` is not part of it. It runs AFTER the site diary's DB step S
(0064, [its runbook](0064-site-diary-step-s.md)): production then holds 65 migrations, and step B
leaves it at 65. It is validated on branch `validate/release-b4`, whose code
is pinned at **`4cf2a68a`**: the branch's last code commit (every commit after
it changes only `docs/DEPLOY.md`). That branch carries `main`, the site diary's
database code exactly as step S applied it (the step S pin `992bca1e`), and
B4. It must carry the site diary's code: after step S the database holds the
site diary's 22 policies, and `db:apply-rls` refuses to finish on a database
holding a policy its own code does not declare.

**Step B is NOT the last database step.** These were asked for in the plan's
"DB step B" addenda and are NOT in it; they wait for a later step that carries
a migration (0066 or later: 0065 is the client home's, below), with its own
runbook, and the owner has not yet decided when:

- the stored folded search columns on contract lines, section titles and the
  price book (`contract_lines.search_text` and its kin), which make a search
  on a very long contract cheap (the per-member read throttle is the backstop
  until then);
- the stored name comparison form on price-book items (`name_ar_form`,
  `name_en_form`) and its index, for the market "add to my price book" name
  check;
- payment reversal (undoing a recorded payment), which has no design yet;
- optionally, the contract lines index for one very large section, and the
  contract link's digest stored at issue (both only if measurements ask).

**THE ORDER (do not change it):**

0. **Two things must already be done.** The site diary's **DB step S** ([its
   runbook](0064-site-diary-step-s.md)), run from its pin `992bca1e`, with its step 4 as expected;
   and **PR A3 deployed** (the contract link /c opening long contracts section
   by section and loading the rest on request), which is on `main` since the
   Stage 2 A3 merge. Step 1 checks both from the code; check yourself that you
   ran step S from `992bca1e`.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6). Do not leave
   a gap: merge within the hour (see the second reason below).

Why this order, one sentence each:

- **The new code needs the new database code:** the delivery page's new
  execution card and the client's "I paid" call two new client functions, and
  the contract link's "show more sections" calls a third; on the old database
  code the card does not show and "show more sections" fails.
- **The current Worker is safe on it, with ONE visible difference while it
  waits for the merge:** the contract link's first answer now carries only its
  first 50 sections (and, between them, the contract's first 50 lines). The
  current page already opens on exactly that, so a client sees the same page;
  but on a contract with MORE than 50 sections, the current page counts the
  sections it was sent, so it shows the first 50 and offers no "show more
  sections" at all: nothing tells that client more exist until this branch is
  deployed. Every other change only adds, or refuses a write the current code
  never makes (rehearsed: see *Rehearsed* for the current code's own action
  tests on the new database).
- **A client "I paid" on a payment request now also writes studio
  notifications** ("The client says they paid payment request PR-2026-0004").
  The current Worker shows an unknown notification as an empty line, never as
  an error, which is the second reason the merge follows step 5 at once. No
  client can send one before the merge: only the new page has the button.

Whether the site diary's branch is already merged to `main` makes no
difference to this step: this branch carries that code either way, and if it
is not merged yet, merging this branch merges it too (it needs only 0064,
which step S applied).

**What it changes.** No row is written, updated or deleted. Nothing is
backfilled. Nothing of the site diary changes (rehearsed: every site policy,
function, trigger and grant identical before and after step 3).

| Object | Change |
|---|---|
| `rls/functions/70-execution-portal.sql` (new) | the delivery page's execution card (`app_delivery_execution_by_token`: the execution contract, its newest 60 payment requests with what is paid and due on each, the newest 60 payments received (same-day ones newest first), the client's notices still waiting on an earlier contract of the delivery, and the studio's payment details only while something is due) and the client's "I paid" on one request (`app_delivery_claim_request_by_token`: claims what is still due, the client sends no amount; tells owners, admins and accountants in the same transaction; at most 10 claims per contract per hour; waits at most 4 s on a busy request; never waits on the delivery row), plus two internal helpers nobody else may call |
| `rls/functions/30-contracts-variations.sql` | the contract link's first answer carries its first 50 sections and, between them, the first 50 lines of the WHOLE contract, plus how many sections it has; a new function serves the sections after the first 50, 50 at a time; the digest the client's acknowledgement covers now also covers every section's title and subtotal. The change-order link (/v) adds the contract's end date and its approved extra days, and a client's approve or reject now waits for a termination in flight (at most 4 s, as the other client answers) and is refused on the terminated contract |
| `rls/functions/35-execution.sql`, `rls/policies/35-execution.sql` | four new trigger functions and eight triggers: a cost entry never moves to another contract, and a voided one is final; a client's claim keeps what the client sent and is answered once; a site measurement goes only on a signed execution contract with no final account, on a day from its issue to tomorrow; and the member a payment request, a payment, a void, a cost entry, a claim's answer or a measurement names as its author must be the member who is signed in |
| `rls/roles.sql` | `metra_app` may update only the 15 columns a cost edit or void writes (it could update every column before); on the client's claims it may no longer insert (only the client's link function writes one) and may update only the 5 columns of the studio's answer; the new functions are callable by `metra_app` only, the two helpers by nobody |
| `packages/db/src/scripts/apply-rls.ts` | unchanged since step S: a file that loses a lock race with live traffic (40P01 or 55P03) is tried again, up to 3 times, with a line saying so (step 3) |

**1. Put the step B code in the production checkout.** This step adds no
dependency of `db:apply-rls`, so the installed `node_modules` serve as they
are. Right after the switch it saves a copy of this runbook: the checkout
undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/release-b4
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-b.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 4cf2a68a HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (4cf2a68a)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --stat 992bca1e HEAD -- packages/db/migrations    # MUST print nothing: the migrations are exactly step S's, 0064 the newest
git show origin/main:apps/web/src/lib/contracts/public.ts | Select-String -SimpleMatch "app_contract_section_lines_by_token"    # MUST print a line: A3 is on main
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Five
STOPs, tell the lead in each case:

- The `git diff --stat 4cf2a68a HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything: the migrations differ from step S's,
  and this runbook covers none.
- The last command prints nothing: PR A3 is not on `main` (step 0).
- You ran step S from a pin other than `992bca1e`, or have not run it: undo
  (0) below would not put back what production runs on.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 65 and `newest` 1792880198159 (0064's journal stamp:
step S is in). Anything else: STOP, tell the lead.

```sql
-- Step B step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything else
means part of step B is already in this database: do not run step 3, tell the
lead.

```sql
-- Step B step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_delivery_execution_by_token', 'app_delivery_claim_request_by_token',
                        'app_delivery_execution_contract', 'app_studio_payment_details',
                        'app_contract_sections_by_token', 'enforce_actor_is_session_user',
                        'enforce_cost_entry_guarded', 'enforce_contract_payment_claim_guarded',
                        'enforce_contract_line_measurement_guarded')) as step_b_functions,
  (select count(*) from pg_trigger t
    where not t.tgisinternal
      and t.tgname in ('trg_payment_requests_actor', 'trg_contract_payments_actor',
                       'trg_contract_cost_entries_actor', 'trg_contract_cost_entries_guarded',
                       'trg_contract_payment_claims_actor', 'trg_contract_payment_claims_guarded',
                       'trg_contract_line_measurements_actor', 'trg_contract_line_measurements_guarded')) as step_b_triggers,
  (select count(*) from public.contract_payment_claims) as client_claims;
```

(c) The sizes. Note the five numbers; step 4 (e) expects the same.

```sql
-- Step B step 2 (c): the execution tables' sizes. Run this one alone.
select (select count(*) from public.payment_requests) as payment_requests,
       (select count(*) from public.contract_payments) as contract_payments,
       (select count(*) from public.contract_cost_entries) as cost_entries,
       (select count(*) from public.contracts where status in ('issued', 'signed')) as contracts_with_a_link,
       (select coalesce(max(n), 0) from (select count(*) as n from public.contract_sections group by contract_id) per_contract) as most_sections_in_one_contract;
```

If `most_sections_in_one_contract` is more than 50, that contract is the one
the first reason under THE ORDER is about: merge at once after step 5.

(d) The six execution tables' grants and triggers, before. Expect exactly:
`contract_cost_entries` S,I,U / 21 / 0; `contract_line_measurements` S / 0 / 0;
`contract_payment_claims` S,I,U / 15 / 0; `contract_payment_milestones`
S,I,U,D / 10 / 1; `contract_payments` S,I / 0 / 1; `payment_requests` S,I,U /
18 / 1 (privileges / updatable columns / triggers). Step 4 (b) runs it again.

```sql
-- Step B step 2 (d): the six tables' grants and triggers. Run this one alone.
select c.relname,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('metra_app', c.oid, a.attnum, 'update')) as updatable_columns,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')
order by 1;
```

(e) Step S's policies are in. Expect `policies` 80 and `restrictive` 15
(the numbers step S's step 4 (d) gave). Step B adds no policy: step 4 (f)
expects the same.

```sql
-- Step B step 2 (e): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

**3. Apply RLS, then prove it landed.** From `C:\Users\HP\merta-main` (its
`.env` is the production connection), **at a quiet hour** (late evening, when
no studio is working; see below). NOT `db:migrate`: step B has no migration.

```powershell
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** `db:apply-rls` prints routine NOTICE blocks with
a `message:` line; on Supabase a line about a role may differ, and any line
that ends `does not exist, skipping` or `already exists, skipping` is the same
kind. In this order: the same first four as every run
(`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
then EIGHT new ones, once only:
`message: 'trigger "trg_contract_cost_entries_guarded" for relation "public.contract_cost_entries" does not exist, skipping',`,
`message: 'trigger "trg_payment_requests_actor" for relation "public.payment_requests" does not exist, skipping',`,
`message: 'trigger "trg_contract_payments_actor" for relation "public.contract_payments" does not exist, skipping',`,
`message: 'trigger "trg_contract_cost_entries_actor" for relation "public.contract_cost_entries" does not exist, skipping',`,
`message: 'trigger "trg_contract_payment_claims_actor" for relation "public.contract_payment_claims" does not exist, skipping',`,
`message: 'trigger "trg_contract_payment_claims_guarded" for relation "public.contract_payment_claims" does not exist, skipping',`,
`message: 'trigger "trg_contract_line_measurements_actor" for relation "public.contract_line_measurements" does not exist, skipping',`
and `message: 'trigger "trg_contract_line_measurements_guarded" for relation "public.contract_line_measurements" does not exist, skipping',`.
Nothing about a site table: step S's objects are re-applied exactly as they
are. A second `db:apply-rls` prints only the first four.

Only a line that starts `apply-rls failed:` is a failure (after one, npm adds
`npm error` lines of its own; they only repeat that the command failed).
Expected:

- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `65 tables, 80 policies, 35 triggers, 68 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 23 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; contract_cost_entries updatable on its 15 entry and void columns only; contract_payment_claims updatable on its 5 answer columns only; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand (or step S is missing). Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 65 declared table(s), every column present.`,
  then `indexes — 147 declared, all present.`, `constraints — 399 declared, all present.`,
  `functions — 68 declared, all present.`,
  `orphaned org rows — 57 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**Run it at a quiet hour** (late evening, when no studio is working): ordinary
traffic is enough to make a file lose a lock race, see below.

**A lock race is retried for you.** A line like
`apply-rls: policies/00-core.sql rolled back with SQLSTATE 40P01 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/00-core.sql ... (attempt 2 of 3)` is NOT a
failure: that one file rolled back whole and is being applied again. Carry on
reading the output.

**If it fails, it prints the SQLSTATE and what to do,** on two lines:
`apply-rls failed: SQLSTATE 40P01: deadlock detected`
(or `SQLSTATE 55P03: canceling statement due to lock timeout`) then
`apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
That means the same file lost three times in a row. The cause is NOT a broken
database, and usually not a long transaction either:

- **40P01, almost always at `Applying policies/00-core.sql ...`** (or
  `policies/40-engagements.sql`): ORDINARY app traffic. That file locks the
  studios table and then the members table; every studio save takes the two
  the other way round (members first, for the "is this a member" check, then
  the studio, for the row's studio link). Two sub-second transactions in
  opposite orders are a deadlock, and Postgres ends one of them, sometimes the
  app's (a studio member may see one save fail and try it again; rarely a
  client's link fails to load once, and a refresh fixes it). Measured: 3 or
  more studio saves a second are enough, and at about 11 a second the three
  attempts can all lose, so the run fails and the next run lands it.
- **55P03, usually at `Applying policies/35-execution.sql ...`:** a long
  studio transaction or report held a table for more than 3 s.

Either way: **run `npm run db:apply-rls` again, and keep re-running it until it
exits 0** (wait a minute between runs; it is safe, every statement is
idempotent). A run that fails at `policies/00-core.sql` prints three notices
before its two failure lines (the `self_memberships` notice comes from that
file itself); a run that lands a file on a later attempt prints that file's
notices after its `(attempt 2 of 3)` line. The run that exits 0 prints the notices of the files the
failed run did not get past (the first four and all eight trigger notices if
it failed at `policies/35-execution.sql`) and the two lines above. In between,
step 2 (b) may show `step_b_functions` 9 and `step_b_triggers` 0, and step 2
(d) the new privileges and updatable columns with the old trigger counts (the
functions files and `roles.sql` ran, a policy file rolled back); the current
site works on that too. Rehearsed: see *Rehearsed* below. Any other code: tell
the lead before running anything else.

**Safe to re-run.** Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints only the first four notices and the same two lines.
`assert-schema-applied` only reads.

**Locks.** Each policy file takes a table lock for an instant per table, and
waits at most 3 s for it (`MIGRATION_LOCK_TIMEOUT`); every file runs as one
transaction, so a file that loses rolls back whole and the script tries it
again (3 attempts, 2 s then 4 s apart). The eight new triggers are attached in
`policies/35-execution.sql`, on tables that now hold live rows, and every run
also re-applies `policies/00-core.sql` and `policies/40-engagements.sql` on the
busiest tables (and step S's `policies/70-site.sql`, on the seven site tables,
which nothing writes yet); while a file waits, the app's saves on those tables
wait behind it (measured: up to about 1.4 s instead of 0.3 s). That is the
reason for the quiet hour.

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` still 65, `newest` still 1792880198159.

(b) Step 2 (b) again: now `step_b_functions` 9, `step_b_triggers` 8,
`client_claims` the same as before (0 before the merge: only the new page has
the button). Then step 2 (d) again: now `contract_cost_entries` S,I / 15 / 2;
`contract_line_measurements` S / 0 / 2; `contract_payment_claims` S / 5 / 2;
`contract_payment_milestones` S,I,U,D / 10 / 1; `contract_payments` S,I / 0 /
2; `payment_requests` S,I,U / 18 / 2.

(c) Who may call the step B functions: 9 rows. `app_execute` true on the three
`app_*_by_token` functions and the four `enforce_*` trigger functions, false on
`app_delivery_execution_contract` and `app_studio_payment_details` (internal:
nobody calls them but the functions beside them); `public_execute` false and
`api_roles_execute` false on all nine.

```sql
-- Step B step 4 (c): who may call the step B functions. Run this one alone.
select p.proname,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_execution_by_token', 'app_delivery_claim_request_by_token',
                    'app_delivery_execution_contract', 'app_studio_payment_details',
                    'app_contract_sections_by_token', 'enforce_actor_is_session_user',
                    'enforce_cost_entry_guarded', 'enforce_contract_payment_claim_guarded',
                    'enforce_contract_line_measurement_guarded')
order by 1;
```

(d) The contract link's first answer, on every contract with a link: one row
each (at most 20), with `opening_sections` at most 50, `opening_lines` at most
50, and `section_count` the contract's real number of sections. It reads only
what a client's link reads.

```sql
-- Step B step 4 (d): what each contract link opens with now. Run this one alone.
select c.number,
       (d.snapshot ->> 'section_count')::int as section_count,
       jsonb_array_length(d.snapshot -> 'sections') as opening_sections,
       (select coalesce(sum(jsonb_array_length(s -> 'lines')), 0) from jsonb_array_elements(d.snapshot -> 'sections') s) as opening_lines
from public.contracts c
cross join lateral (select public.app_contract_by_token(c.token_hash) as snapshot) d
where c.token_hash is not null and c.status in ('issued', 'signed')
order by c.number desc
limit 20;
```

(e) Step 2 (c) again: the same five numbers as before.

(f) Step 2 (e) again: still `policies` 80 and `restrictive` 15.

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still runs
the current `main`. About ten minutes, in your own studio only. Open the log
first, in a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open **Contracts** in the sidebar (العقود) and one contract,
   then, if it is an execution contract, its **Payments** tab (الدفعات), its
   costs page and its change-order tab. Then a delivery (التسليمات), a project
   and the price book. Expected: every page loads and shows your data as
   before. A list that is suddenly EMPTY counts as a failure too.
2. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`) or a delivery link (`/d/...`) you sent
   to yourself, open each: it shows as before, and on the contract link "show
   lines" on a section still opens its lines. Only look: do not sign, approve or
   say you paid anything. No test link: skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42883`, no `MT100`,
no `MT140`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step 5
   (1) again, now on the new code. If a test delivery of yours is at the
   execution stage and its contract is signed, open its delivery link: under
   the payments card there is a "Construction contract" card (عقد التنفيذ) with
   the contract's number. Only look. Expected in the log: no `42501`, no
   `42883`, no `MT140`, no `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The database code, before the merge** (step 5 fails, or before the merge
the log shows a `42501`, an `MT140` or a studio reports a broken page). Two
parts: the `db:apply-rls` of the code step S ran from (`992bca1e`: `main`'s
database code plus the site diary's, the database code production ran on just
before step 3), which puts back the contract link without the cap, the
change-order link without the two new keys and without the wait for a
termination, the cost entries' full UPDATE and the claims' insert and full
UPDATE; then one SQL block that removes what that code does not know (the
eight triggers and the nine functions). No SQL block is needed BEFORE that
`db:apply-rls` (the site diary's undo needs one, for its policies): step B adds
no policy, so that code's own check finds nothing it does not declare.
Afterwards the database is exactly as it was before step 3: rehearsed, a
catalogue comparison found zero differences. Use it only while the site still
runs the code from before the merge: if the new code is already deployed, undo
(1) the code first, then this. Any "I paid" a client sent in between stays
recorded as a pending claim (data, not code); tell the lead how many step 2 (b)
shows.

From the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach 992bca1e
git log --oneline -1    # 992bca1e S2 re-check fixes: an insert is asked what an update is, own rows, device and assignment identity
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; only the FIRST FOUR notices of step 3; and it ends with
the two lines that code prints, the first going on
`65 tables, 80 policies, 27 triggers, 59 functions, RLS forced on all of them, role metra_app present.`
and the second the same as step 3's WITHOUT the two parts
`contract_cost_entries updatable on its 15 entry and void columns only; ` and
`contract_payment_claims updatable on its 5 answer columns only; `.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3 (that code retries a file for you too, the same 3 attempts): **run
`npm run db:apply-rls` again from this checkout, and keep re-running it until it
exits 0.** Any other code: stop and tell the lead.

**Do not run the SQL block below until this `db:apply-rls` has exited 0.** The
block drops functions the step B triggers call; run before that code's files
have all landed, it can leave the database between the two versions.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step B undo (0), part 2: the objects the step S code does not know. Run this one alone.
set lock_timeout = '3s';
drop trigger if exists trg_payment_requests_actor on public.payment_requests;
drop trigger if exists trg_contract_payments_actor on public.contract_payments;
drop trigger if exists trg_contract_cost_entries_actor on public.contract_cost_entries;
drop trigger if exists trg_contract_cost_entries_guarded on public.contract_cost_entries;
drop trigger if exists trg_contract_payment_claims_actor on public.contract_payment_claims;
drop trigger if exists trg_contract_payment_claims_guarded on public.contract_payment_claims;
drop trigger if exists trg_contract_line_measurements_actor on public.contract_line_measurements;
drop trigger if exists trg_contract_line_measurements_guarded on public.contract_line_measurements;
drop function if exists public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text);
drop function if exists public.app_delivery_execution_by_token(text);
drop function if exists public.app_delivery_execution_contract(uuid, uuid);
drop function if exists public.app_studio_payment_details(uuid);
drop function if exists public.app_contract_sections_by_token(text, integer);
drop function if exists public.enforce_actor_is_session_user();
drop function if exists public.enforce_cost_entry_guarded();
drop function if exists public.enforce_contract_payment_claim_guarded();
drop function if exists public.enforce_contract_line_measurement_guarded();
```

Expected: `Success. No rows returned`. Run it at the same quiet hour: each
`drop trigger` locks its table, and the first line makes the block give up
after 3 s instead of holding the money tables while a long report finishes.
If it fails with `canceling statement due to lock timeout`, nothing was
dropped (the editor runs the block as one transaction): run the same block
again a minute later, until it succeeds. Then, read-only, each block ON ITS OWN:
step 2 (b) again (`step_b_functions` 0, `step_b_triggers` 0), step 2 (d)
again (exactly what step 2 (d) expects) and step 2 (e) again (80 and 15).
Then step 5 again: everything works as it did before step 3. Put the checkout
back on main (step 6 (3)) and tell the lead what failed the first time. Do not
merge. If step 5 STILL fails after undo (0), the database code was not the
cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then step
3 (`npm run db:apply-rls`, whose first run prints the eight trigger notices
again; re-run it until it exits 0, as step 3 says), then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**Rehearsed** (B4 release, Oct 25) on a local PostgreSQL 17 database (UTF8)
built to production's shape: Supabase's API roles and default grants
simulated first; then `main`'s database code (`0f9cb2db`, 0063: `db:migrate`,
`db:apply-rls`, `seed`); 5,003 projects, 5,003 contracts and 50,542 contract
lines in 22 studios, a delivery at execution with a signed execution contract
of 121 sections (one of 300 lines), a part-paid payment request, a cost entry
and an approved change order of 15 days (no client claim, as in production);
then DB step S from `992bca1e` (`db:migrate`, `db:apply-rls`,
`assert-schema-applied`: 65 migrations, 80 policies). Every command and SQL
block above was then run as written, from a separate clone standing in for
`merta-main` (its own `npm ci`, `origin` on GitHub, `origin/main` at
`0f9cb2db`): the PowerShell from scripts made of this section's blocks with
three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy.

- Steps 1 to 4 printed exactly what they say. Step 1's three guards printed
  nothing and the A3 line printed; step 3 printed the four notices, the eight
  trigger notices in the order listed, the two lines and the six
  `assert-schema-applied` lines; the second run printed only the four. An md5
  of every row of fifteen tables (projects, contracts with their sections and
  lines, the six execution tables, change orders, deliveries, notifications,
  members, studios) was identical before and after.
- A catalogue comparison (every policy, function body with its settings and
  grants, trigger, table and column grant, and the role) before and after step
  3 found exactly the changes under *What it changes*: 9 functions and 8
  triggers added; the contract link, the change-order link and the
  change-order answer replaced; the cost entries' UPDATE turned into 15 column
  grants and the claims' INSERT and UPDATE into 5; nothing else, so no site
  diary object changed.
- **The lock race, on purpose.** A reader holding `contract_cost_entries` for
  30 s while step 3 ran on the step B database: `policies/35-execution.sql`
  lost three times (55P03), and `apply-rls` exited 1 with the two failure lines
  after 19 s; the re-run after the reader ended exited 0, the catalogue
  unchanged.
- **Undo (0)**, from the saved copy: `992bca1e`'s `db:apply-rls` printed the
  four notices and the two lines quoted there and exited 0; the SQL block
  returned no rows; step 2 (b), (d) and (e) read as before step 3; and the
  catalogue was identical to the one before step 3 (zero differences).
- **Forward again**, with the same 30 s reader: the first run exited 1 as
  above, printing only the four notices before the failure lines; in between,
  step 2 (b) read 9, 0 and 0 and step 2 (d) the new privileges and columns with
  the old trigger counts; the re-run after the reader ended exited 0 with the
  four and the eight notices, and the catalogue was identical to the first
  forward's.
- The 40P01 figures under step 3 and *Locks* (3 or more studio saves a second;
  saves waiting about 1.4 s) come from the B4 fix round's rehearsal (Oct 20);
  the `apply-rls` retry is byte-identical since.
- **The current code on the step B database**, each run on a freshly applied
  step B (one action test file, `execution-schema.dbtest.ts`, re-runs its own
  checkout's `roles.sql` and so puts the old grants back for the files after
  it; it was run on its own). `main` plus the site diary (`992bca1e`, what
  `main` is once the site diary is merged): isolation gate 60 of 60, action
  tests 1,571 of 1,584 passed (one is a todo). `main` alone (`0f9cb2db`):
  isolation gate 59 of 59, action tests 1,458 of 1,472 passed (one todo). The
  12 failures common to both test what step B changes on purpose, and no app
  path: 4 test the uncapped contract link of step A (the visible difference
  under THE ORDER); 1 pins the list of client functions; 1 pins step A's
  grants on the six execution tables; 1 inserts a claim as `metra_app` (now
  only the client's link function may); 4 write site readings as `metra_app`
  that the new measurement guard refuses (dated before their test contract was
  issued, as the measurement screen already refuses them); and 1 fails the same
  way on the database before step 3 (it checks a Supabase default grant that
  this rehearsal's simulated roles add and `roles.sql` does not manage).
  `main` alone has one more, which counts the composite set-null foreign keys
  and fails on any database with 0064 (step S's runbook says so). No cost
  entry, payment, payment request, final account or measurement-screen test of
  the shipped code failed under the new guards and grants.
