# Client codes DB step D (0066, the one-time codes): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

The client codes' database step: migration `0066_client_codes_step_d.sql`
plus `db:apply-rls` (changes to `rls/functions/75-client-home.sql` and
`rls/roles.sql`; no new file). It runs AFTER client home DB step C ([its
runbook](0065-client-home-step-c.md)): production then holds 66 migrations, 81 policies (15 of them
restrictive) and 100 functions; step D leaves it at 67, 81 (15) and 102 (two
functions are added, and eight are replaced by new forms). It is validated on
branch `validate/home-h5`, whose code is pinned at **`52ac1ae4`**: the
branch's last code commit (every commit after it changes only
`docs/DEPLOY.md`). That branch is `main` (`bab6de80`: PR H3, PR H4 and the
paper decision) plus PR H5 and its fix round: the client's one-time codes,
and "I paid" only through a code.

**Step D is not the last client home step.** DB step C2 (apply-rls only)
still comes later, after PR H7 is live: the four old client acts will then
answer `moved` unless a code was checked first. Step D changes none of those
four answers.

**THE ORDER (do not change it):**

0. **Already done:** client home **DB step C**, run from its pin `31e21c8f`,
   and PR H3 merged: `main` is `bab6de80` or later. Step 1 checks the code;
   check yourself that you ran step C.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs the new database code:** a client's code request and
  "I paid" call the new forms of the code functions (the code is checked by
  the payment it is for, not by an id the browser keeps), which the old
  database does not have, so every code request would fail with a reference.
- **The current Worker is safe on the new database, with no visible
  difference:** 0066 only adds an empty column to `design_engagements` that
  the current code never reads or writes, and an index to the codes table,
  which is empty (no released code asks for a code yet); the functions step D
  replaces or adds have no caller in the current code (checked on `main` at
  `bab6de80`: no file under `apps/web/src` names them).
- **No client sees anything new** until PR H5 is merged.
- **PR H6-read** (not merged yet) calls the two contract page reads in their
  OLD form: from step D on it must pass the contract id (the lead's ruling),
  so it is merged only after step D, with that change.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `design_engagements` | one column, `client_codes_reset_at` (empty on every row, no default): when an owner or admin last reset the client's one-time codes on that delivery. Written only by `app_client_codes_reset` below; `metra_app` may not update it (it holds the table's SELECT and INSERT, as on every other column of this table) |
| `client_verification_codes` | one partial index, `client_verification_codes_unused_created_idx` (the codes never used, or never sent, by when they were made): the code request removes such codes 90 days after they expired, and reads them through it without walking past the used ones, which stay as evidence |
| `app_home_code_issue_by_token` | a new form without the code id the app used to make (the old one is dropped). The limits: 60 s and 5 an hour for one payment, 15 wrong tries on its codes in an hour, **10 codes a delivery a day** (counted from the studio's last reset), 25 a studio a day and 80 across the platform; a code whose email failed counts only toward its payment's 60 s. A refusal names the limit that fired; a lock wait on any table answers `busy`. Its `ok` answer carries, for the server only, the code's row, the studio's two names, the document's number and whether this code is the one that took the platform's day to half its 80 |
| `app_client_code_check` (internal) | a new form: it checks the code against the NEWEST code of the payment it is for (a client back from the email, or after a reload, can still type it) |
| `app_home_contract_ack_by_token`, `app_home_variation_respond_by_token`, `app_home_claim_request_by_token`, `app_home_claim_design_payment_by_token` | new forms without the code id; a lock wait on any table answers `busy`; "I paid" past the contract's 10 claims in an hour answers `too_many` with the wait |
| `app_home_code_unsent_by_token` (new) | the server marks a code whose email failed as never sent, so it spends no day |
| `app_client_codes_reset` (new) | an owner's or admin's reset of one client's codes on one delivery (the client link dialog, audited): every code sent before it stops working, and the delivery's own limits count from it |
| `app_home_contract_sections_by_token`, `app_home_contract_section_lines_by_token` | each now takes the id of the contract the client opened, and answers nothing unless that contract is still the home's: an open document never gains a replaced contract's sections (H6-read security S1). The old forms (without the id) are dropped |
| `enforce_client_code_guarded` (trigger) | the 90-day purge may also remove a code that was never sent |
| `rls/roles.sql` | the grants follow the new forms: callable by `metra_app` only (the code check: by nobody) |

**1. Put the step D code in the production checkout.** This step adds no
dependency of `db:migrate` or `db:apply-rls`, so the installed `node_modules`
serve as they are. Right after the switch it saves a copy of this runbook:
the checkout undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/home-h5
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-d.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 52ac1ae4 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (52ac1ae4)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --name-only bab6de80 HEAD -- packages/db/migrations    # MUST print exactly the three 0066 files below
```

The last command must print exactly these three lines, in this order:

```
packages/db/migrations/0066_client_codes_step_d.sql
packages/db/migrations/meta/0066_snapshot.json
packages/db/migrations/meta/_journal.json
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Four
STOPs, tell the lead in each case:

- The `git diff --stat 52ac1ae4 HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything else: this runbook covers 0066 only.
- You ran step C from a pin other than `31e21c8f`, or have not run it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 66 and `newest` 1792976742588 (0065's journal stamp).
Anything else: STOP, tell the lead.

```sql
-- Step D step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** `step_d_index` 0,
`reset_column` 0, `step_d_functions` 0, `step_c_functions` 3. Anything else
means part of step D is already in this database (or step C is not): do not
run step 3, tell the lead.

```sql
-- Step D step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'client_verification_codes_unused_created_idx') as step_d_index,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'design_engagements' and column_name = 'client_codes_reset_at') as reset_column,
  (select count(*) from (values
     (to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)')),
     (to_regprocedure('public.app_home_code_unsent_by_token(text, uuid)')),
     (to_regprocedure('public.app_client_codes_reset(uuid)')),
     (to_regprocedure('public.app_home_contract_sections_by_token(text, uuid, integer)')),
     (to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer)'))) f(p)
    where f.p is not null) as step_d_functions,
  (select count(*) from (values
     (to_regprocedure('public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text)')),
     (to_regprocedure('public.app_home_contract_sections_by_token(text, integer)')),
     (to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, integer)'))) f(p)
    where f.p is not null) as step_c_functions;
```

(c) The codes table. Note the two numbers (production has had no caller of
the code request, so expect 0 and 0); step 4 (e) expects the same.

```sql
-- Step D step 2 (c): the codes table. Run this one alone.
select count(*) as codes, count(*) filter (where consumed_at is null) as never_used
from public.client_verification_codes;
```

(d) Expect `policies` 81 and `restrictive` 15 (step C's step 4 (g)). Step 4
(f) expects the same.

```sql
-- Step D step 2 (d): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(e) The database size. Write the number down; step 4 (g) reads it again.

```sql
-- Step D step 2 (e): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*). Each
line runs its command only if the one before it exited 0, so a failure stops
the block there:

```powershell
npm run db:migrate
if ($LASTEXITCODE -eq 0) { npm run db:apply-rls }
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line; on Supabase the line about a role may differ, and any line
that ends `does not exist, skipping` or `already exists, skipping` is the same
kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`: the same first four as every run
  (`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
  and nothing else on this first run (the old forms step D replaces exist,
  so their DROPs print nothing). A RE-RUN of `db:apply-rls` on the step D
  database prints eight more, right after the first two, one for each form
  step D dropped, in this order:
  `message: 'function public.app_client_code_check(uuid,uuid,uuid,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_contract_sections_by_token(text,pg_catalog.int4) does not exist, skipping',`,
  `message: 'function public.app_home_contract_section_lines_by_token(text,uuid,pg_catalog.int4) does not exist, skipping',`,
  `message: 'function public.app_home_code_issue_by_token(text,uuid,text,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_contract_ack_by_token(text,uuid,uuid,text,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_variation_respond_by_token(text,uuid,text,uuid,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_claim_request_by_token(text,uuid,uuid,text,text,text,text,text) does not exist, skipping',`
  and `message: 'function public.app_home_claim_design_payment_by_token(text,text,uuid,text,text,text,text,text) does not exist, skipping',`.
  (The forward-again of undo (0) prints only the four: undo puts the old
  forms back.)

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (67).
- `db:apply-rls` exits 0 and ends with two lines: the first starts
  `apply-rls: verified in the catalogues` and goes on
  `66 tables, 81 policies, 36 triggers, 102 functions, RLS forced on all of them, role metra_app present.`
  (step C's said 100 functions: step D adds two); the second starts
  `apply-rls: grants verified` and is word for word step C's step 3 line
  (`... 24 narrowed table(s) ... client_verification_codes readable on every column but code_hash; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`).
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand. Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, each starting
  `assert-schema-applied:`, in this order: `OK` then `66 declared table(s), every column present.`;
  `indexes` then `151 declared, all present.`; `constraints` then
  `413 declared, all present.`; `functions` then `102 declared, all present.`;
  `orphaned org rows` then
  `58 org-scoped table(s) answered, none holds a row whose org_id names no organization.`;
  and `composite set-null FKs` then
  `16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/36-client-home.sql rolled back with SQLSTATE 55P03 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/36-client-home.sql ... (attempt 2 of 3)` is
NOT a failure: that one file rolled back whole and is being applied again (3
attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0066: could not take every lock within 3 s (stopped at public.client_verification_codes:SHARE)`
  (or `(stopped at public.design_engagements:ACCESS EXCLUSIVE)`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its two locks with NOWAIT (see *Locks*), tries again
  every 10 to 40 ms for 3 s in all, and holds nothing while it tries, so no
  request waited on it. The table named is the one a long transaction held
  for those 3 s. Re-run the block a little later.
- `apply-rls failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row: a studio transaction or
  report held what it needed for more than 3 s (a 40P01 is ordinary studio
  traffic; step B's runbook says why). **Run `npm run db:apply-rls` again, and
  keep re-running it until it exits 0** (wait a minute between runs; it is
  safe, every statement is idempotent), then
  `npm run assert-schema-applied -w @metra/db`. In between, step 2 (b) may
  read `1, 1, 5, 0` (`functions/75-client-home.sql` runs before the policy
  files, so the new forms are in while a later file lost its race): the
  current site works on that, as it calls none of those forms, and a run that
  exits 0 changes nothing more in step D's objects.
- `Migration failed: SQLSTATE 42701: column "client_codes_reset_at" of relation "design_engagements" already exists`
  (or `SQLSTATE 42P07: relation "client_verification_codes_unused_created_idx" already exists`)
  then `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of step D is already in this database, which step 2 (b) would have
  shown. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0066 only when it commits, so after
any failure a re-run starts again from 0065; after a success it finds nothing
pending and prints `Migrations applied.` again. Every statement under `rls/`
is idempotent: a second `db:apply-rls` prints the same two verified lines
(its notices are under step 3). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0066 as ONE transaction. It first takes ACCESS
EXCLUSIVE on `design_engagements` (for its new column: every delivery read
waits) and SHARE on `client_verification_codes` (reads go on, writes wait),
each with NOWAIT, within one 3 s budget for all its attempts: if a table is
busy it releases what it took, sleeps 10 to 40 ms and tries again, so it
never queues behind a page read or a code act (and never makes the next ones
queue behind it). Then it adds the column (no default: catalogue only, no row
is rewritten) and builds the index. Not `CONCURRENTLY`: `db:migrate` runs a
migration inside a transaction, where a concurrent index build cannot run,
and the codes table is empty in production (step 2 (c)), so the whole
migration takes milliseconds. Nothing in the current site writes the codes
table. `db:apply-rls` re-creates the code functions in
`functions/75-client-home.sql` (a DROP of each old form and a CREATE of each
new one: no table lock) and runs every other file as it always does (the
worst cases in step B's runbook are unchanged); a file that loses a lock race
is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` 67, `newest` 1793044397504 (0066's journal
stamp).

(b) Step 2 (b) again: now `step_d_index` 1, `reset_column` 1,
`step_d_functions` 5 and `step_c_functions` 0.

(c) The new index is valid and partial, the new and changed functions are the
definers `metra_app` may call and nobody else, and the internal code check is
callable by nobody: one row, `valid_index` 1, `definers` 9, `app_execute` 9,
`others_execute` 0, `check_callable` 0.

```sql
-- Step D step 4 (c): the index and who may call the new and changed functions. Run this one alone.
select
  (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'client_verification_codes_unused_created_idx' and i.indisvalid
      and pg_get_indexdef(i.indexrelid) like '%WHERE ((consumed_at IS NULL) OR (result_ref = id))') as valid_index,
  count(*) filter (where p.prosecdef) as definers,
  count(*) filter (where has_function_privilege('metra_app', p.oid, 'execute')) as app_execute,
  count(*) filter (where exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                      or coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                                    where r.rolname in ('anon', 'authenticated', 'service_role')), false)) as others_execute,
  (select count(*) from pg_roles r
    where r.rolname in ('metra_app', 'anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, to_regprocedure('public.app_client_code_check(uuid, uuid, text, text, text)'), 'execute')) as check_callable
from pg_proc p
where p.oid in (to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)'),
                to_regprocedure('public.app_home_code_unsent_by_token(text, uuid)'),
                to_regprocedure('public.app_client_codes_reset(uuid)'),
                to_regprocedure('public.app_home_contract_ack_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_variation_respond_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_claim_request_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_claim_design_payment_by_token(text, text, text, text, text, text, text)'),
                to_regprocedure('public.app_home_contract_sections_by_token(text, uuid, integer)'),
                to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer)'));
```

(d) The code request's daily rule is the one in the database: one row,
`delivery_cap_10` true, `names_its_limit` true, `guess_sum_rule` false.

```sql
-- Step D step 4 (d): the code request's daily rule. Run this one alone.
select p.prosrc like '%having count(*) >= 10)%' as delivery_cap_10,
       p.prosrc like '%''delivery_day''%' as names_its_limit,
       p.prosrc like '%tries_since >= 50%' as guess_sum_rule
from pg_proc p
where p.oid = to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)');
```

(e) Step 2 (c) again: the same two numbers as before.

(f) Step 2 (d) again: `policies` 81 and `restrictive` 15.

(g) Step 2 (e) again: about the same size as before. Put the number in the
release note.

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still runs
the current `main`. About five minutes, in your own studio only. Open the log
first, in a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio: open **Deliveries** (التسليمات) and a
delivery at the execution stage, an execution contract and its **Payments**
tab (الدفعات), and the dashboard. If a test project of yours has a delivery
link (`/d/...`) you sent to yourself, open it too (only look: do not say you
paid anything). Expected: every page loads and shows your data as before,
and the log shows no `42501`, no `42883`, no `MT100`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (the same evening).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 again, now on the new code. Then, only if you have a test delivery link
   whose client email is an address you read, open its "I've made this
   payment" and press **Send the code** (أرسل الرمز). Expected: the code
   arrives, and its button opens the same payment with the code box already
   open (or, until the Resend sending domain is verified, the panel says the
   code could not be sent with a one-minute countdown, and the log shows one
   `client code email not sent:` line with `"statusCode":403`: that is the
   honest answer, not a failure of this step). Do not type the code: nothing
   is claimed. The log shows no `42883`, no `42501`, no `MT100` and no
   `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The database code, before the merge** (step 5 fails, or before the merge
the log shows a `42501`, a `42883` or an `MT100`, or a studio reports a broken
page). Two parts: the `db:apply-rls` of `main` (`bab6de80`, the database code
production ran on just before step 3: step C's), which puts back the code
functions as they were and the two contract page reads without the contract
id; then one SQL block that removes the forms that code does not know. It
leaves 0066 itself alone: the column (empty) and the index stay (neither
changes an answer). Use it only while the site still runs the code from
before the merge: if the new code is already deployed, undo (1) the code
first, then this.

From the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach bab6de80
git log --oneline -1    # bab6de80 Merge remote-tracking branch 'origin/validate/home-h7-paper' into validate/release-h7p
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; the four notices of step 3; and the two verified lines
of step C (`66 tables, 81 policies, 36 triggers, 100 functions ...` and the
grants line): that code declares 100 functions, and the new forms are extra
to it, not missing.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3: **run `npm run db:apply-rls` again from this checkout, and keep
re-running it until it exits 0.** Any other code: stop and tell the lead.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step D undo (0), part 2: the forms main's code does not know. Run this one alone.
set lock_timeout = '3s';
drop function if exists public.app_home_contract_sections_by_token(text, uuid, integer);
drop function if exists public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer);
drop function if exists public.app_home_code_issue_by_token(text, text, text, text, text, text);
drop function if exists public.app_home_code_unsent_by_token(text, uuid);
drop function if exists public.app_client_codes_reset(uuid);
drop function if exists public.app_client_code_check(uuid, uuid, text, text, text);
drop function if exists public.app_home_contract_ack_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_variation_respond_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_request_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_design_payment_by_token(text, text, text, text, text, text, text);
```

Expected: `Success. No rows returned`. If it fails with `canceling statement
due to lock timeout`, nothing was dropped: run it again a minute later. Then,
read-only, each block ON ITS OWN: step 2 (b) again (now `step_d_index` 1,
`reset_column` 1, `step_d_functions` 0, `step_c_functions` 3: the index and
the column stay, the rest is as before step 3) and step 2 (d) again (81 and
15). Then step 5 again: everything works as it did before step 3. Put the
checkout back on main (step 6 (3)) and tell the lead what failed the first
time. Do not merge. If step 5 STILL fails after undo (0), the database code
was not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` and, if it exits 0,
`npm run assert-schema-applied -w @metra/db` (0066 is still applied, so
`db:migrate` is not needed; if you run it anyway it prints
`Migrations applied.` and changes nothing):

```powershell
npm run db:apply-rls
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

Expected: the four notices of step 3 (undo put the old forms back, so their
DROPs print nothing), the two verified lines and the six
`assert-schema-applied` lines of step 3 (re-run until it exits 0, as step 3
says); then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The column and the index:** never needed (neither changes an answer).
If the lead ever wants them gone, it is a new migration, never a hand edit
here.

**Rehearsed** (the H5 fix round, Oct 27). Every command and SQL block above
was run as written, at `52ac1ae4` (the branch at `209e8057`, this runbook
before this note), on a local PostgreSQL 17 database (UTF8) built in
production's own order: Supabase's API roles and default grants simulated
first; then `main`'s database code at `0f9cb2db` (`db:migrate`,
`db:apply-rls`, `seed`); DB step S from `992bca1e`; DB step B's
`db:apply-rls` from `65c78473`; DB step C from `bab6de80` (`npm ci`,
`db:migrate`, then `main`'s own `db:apply-rls`) and `assert-schema-applied`;
then data written by `main`'s own cores (three studios: deliveries at every
execution stage, a client's claim, change orders approved, internal and
expired, a final account, a termination, contracts no delivery stands behind)
and a bulk of ten studios: 2,023 contracts, 21 deliveries, 66 migrations, no
code. The runs used a fresh clone standing in for `merta-main` (its own
`npm ci`, `origin` on GitHub): the PowerShell cut from this section with
three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy, each block on its own.

- Steps 1 to 4 printed exactly what they say. Step 1's guards printed only the
  `docs/DEPLOY.md` line and the three 0066 files, and the saved copy equals
  the branch's runbook (line endings aside). Step 2 read 66 and
  1792976742588; 0, 0, 0 and 3; 0 and 0; 81 and 15; 35 MB. Step 3 printed the
  two migrate notices, the four apply-rls notices, the two verified lines
  (102 functions) and the six `assert-schema-applied` lines, and exited 0.
  Step 4 read 67 and 1793044397504; 1, 1, 5 and 0; 1, 9, 9, 0 and 0; true,
  true and false; 0 and 0; 81 and 15; 36 MB.
- A catalogue comparison (every function body with its settings and grants,
  policy, trigger, table and column grant, constraint, index and RLS flag)
  from step C to step D found exactly the changes under *What it changes*:
  nine function forms gone (the code request, the code check, the four acts,
  the two page reads, and the guard trigger's old body) and eleven present
  (their new forms, the new guard body, `app_home_code_unsent_by_token` and
  `app_client_codes_reset`), the grants `metra_app` only and the code check
  nobody's; the new column under the table's existing grants (`metra_app`
  SELECT and INSERT, Supabase's `service_role` as on every column, no UPDATE
  for `metra_app`); one index; nothing else.
- A second step 3 printed `Migrations applied.`, the four notices and the
  eight `does not exist, skipping` ones in the order step 3 lists them, the
  same verified and `assert-schema-applied` lines, and changed nothing in the
  catalogue.
- **The migration's lock race, on purpose.** A writer holding the codes table
  (ROW EXCLUSIVE, an open insert) for 10 s against step 3: the two 55P03
  lines naming `public.client_verification_codes:SHARE`, exit 1, nothing run
  after them; step 2 (a) still 66, step 2 (b) still 0, 0, 0 and 3. The block
  run again after the writer ended applied 0066 and printed what step 3 says.
- **apply-rls's lock race, on purpose.** A reader holding the codes table for
  30 s while step 3 ran: 0066 applied, then `policies/36-client-home.sql`
  lost three times (55P03, retried after 2 s and 4 s), the two failure lines,
  exit 1, `assert-schema-applied` skipped; in between, step 2 (b) read 1, 1,
  5 and 0. `db:apply-rls` then `assert-schema-applied` run again after the
  reader ended exited 0 (the four notices and the eight skipping ones), and
  the catalogue was identical to a clean run's.
- **Undo (0)**, from the saved copy: `bab6de80`'s `db:apply-rls` printed the
  four notices and step C's two verified lines (100 functions), and exited 0;
  part 2 returned no rows; step 2 (b) read 1, 1, 0 and 3, step 2 (d) 81 and
  15; and the catalogue equalled step C's but for the column and the index
  0066 keeps.
- **Forward again** (step 1, then the forward-again block: `db:apply-rls`,
  then `assert-schema-applied`): the four notices, the two verified lines and
  the six `assert-schema-applied` lines of step 3, exit 0; step 2 (b) 1, 1, 5
  and 0, step 4 (c) and (d) as before, 81 and 15; and a catalogue identical
  to the first forward's. Step 6 (3) then put the checkout back on `main`.
- **The current code on the step D database:** `main`'s (`bab6de80`) own
  isolation gate passed 60 of 60, and its action tests 1,762 of 1,814, on a
  copy of this step D database. Every one of the 52 failures is a test of the
  database objects step D changes, not of an app path: 50 call the code
  request, the four code acts or the two page reads directly in SQL in their
  old forms (42883: the forms step D drops, which no code on `main` calls) or
  pin the list and the count of those functions; one runs `main`'s own
  `roles.sql`, which grants on the old forms (42883); and one fails the same
  way on the step C database (checked again on a copy of it: it checks a
  Supabase default grant that the simulated roles add and `roles.sql` does
  not manage). No contract, change
  order, delivery, payment, claim, final account or measurement test of the
  shipped code failed.
- **This branch's own tests** on a fresh database replayed as CI builds it:
  the isolation gate passed 60 of 60 and the action tests 1,858 of 1,858.
