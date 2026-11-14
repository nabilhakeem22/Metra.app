# Security batch 3 DB step (0067): owner runbook

A section name in italics that is not in this file is a section of the
[deployment runbook](../DEPLOY.md), or a sibling file in this folder.

The database step of security fix round, batch 3: migration
`0067_security_batch_3.sql` plus `db:apply-rls` (one new file,
`rls/functions/90-sign-in.sql`, and changes to `rls/functions/00-org-context.sql`,
`rls/roles.sql` and `rls/policies/00-core.sql`). It runs AFTER client codes DB
step D ([its runbook](0066-client-codes-step-d.md)): production then holds 67
migrations, 81 policies (15 of them restrictive), 36 triggers and 102
functions; this step leaves it at 68, 82 (15), 37 and 105. It is validated on
branch `validate/sec-batch-3-db`, whose code is pinned at **`476ceebc`**: the
branch's last code commit (every commit after it changes only files under
`docs/`). That branch is `main` at `73d3433d` (batch 3 push 1 merged) plus the
five commits of push 2.

**Not rehearsed on a database yet.** The runbooks before this one were each
run end to end on a local PostgreSQL 17 before the owner saw them. This one
was written without a database: every expected output below is derived from
the code and from CI's from-scratch replay, not from a run of these commands.
The lead rehearses it (as step D's *Rehearsed* section describes) and fills in
what was measured before you run step 3.

**THE ORDER (do not change it):**

0. **Already done:** client codes DB step D (the ledger holds 67 migrations,
   0000 to 0066). Push 1 of this batch may or may not be deployed; nothing
   below depends on it.
1. **The database goes first**, from the branch (steps 1 to 4), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, the undo puts the previous database
   code back.
3. **Then** the lead merges the branch to `main`. Its deploy changes nothing
   a user can see (step 6).

Why this order: the deployed Worker is safe on the new database, and nothing
in this branch's app code needs the new database before it is merged.

- **The current Worker keeps working between steps 3 and 6.** It never
  deletes an organization; it writes only `revoked_at` and `updated_at` on
  `api_keys` and only the answer columns on `client_payment_claims`, and
  inserts no claim (the client's link functions do, as their owner); its four
  membership writers (create a studio, accept an invitation, change a role,
  remove a member) pass the new trigger; nothing calls `enforce_same_org`
  (step 2 (c) proves it on production); `text_has_visible_character` answers
  the same; and the new table and its two functions have no caller until push
  3 of this batch.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `sign_in_failures` (new table) | one row per sign-in identifier that typed a wrong code in the last hour, keyed by a hash of the identifier: no address, no user, no studio. RLS enabled and forced by the migration; `metra_app` holds no privilege on it and its one policy refuses every row. Empty until push 3 |
| `app_sign_in_pause_seconds`, `app_sign_in_failure_record` (new) | the pause's read and its counter: the tenth wrong code in one hour pauses that identifier until the hour ends. Callable by the connection role only (not `metra_app`, not the API roles). No caller until push 3 |
| `text_has_visible_character` | gets a pinned, empty `search_path` (a Supabase advisor finding). It answers the same |
| `enforce_same_org` | dropped: a trigger function no table ever used (the other advisor finding) |
| `organizations` | `metra_app` loses DELETE (no app path deletes a studio) |
| `api_keys` | `metra_app` keeps SELECT and INSERT; its UPDATE narrows to `revoked_at` and `updated_at`, so a key's creator, hash and studio can never be rewritten |
| `client_payment_claims` | `metra_app` keeps SELECT; it loses INSERT, and its UPDATE narrows to the five answer columns (`status`, `confirmed_payment_event_id`, `resolved_by`, `resolved_at`, `updated_at`) |
| `memberships` | a new trigger, `trg_memberships_role_writer`: as `metra_app`, only an owner or admin grants, changes or removes a role, only an owner touches owner, and a person joining takes `owner` in a studio with no member or exactly the role of the invitation they claimed in the same transaction. Anything else is refused with SQLSTATE `MT150`. SQL you run yourself in Supabase is not judged |
| `app_membership_writer_facts`, `enforce_membership_role_writer` (new) | the trigger's function and the fact reader it calls; `metra_app` only |

**1. Put the code in the production checkout.** This step adds no dependency
of `db:migrate` or `db:apply-rls`, so the installed `node_modules` serve as
they are. Right after the switch it saves a copy of this runbook: the checkout
the undo switches to does not contain it.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/sec-batch-3-db
Copy-Item docs\db-steps\0067-security-batch-3.md $HOME\Desktop\runbook-0067.md
git log --oneline -1    # a commit that changes only docs/ (this runbook); CI green on it
git diff --stat 476ceebc HEAD    # MUST list only files under docs/: the code is exactly what CI proved (476ceebc)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --name-only 73d3433d HEAD -- packages/db/migrations    # MUST print exactly the three 0067 files below
```

The last command must print exactly these three lines, in this order:

```
packages/db/migrations/0067_security_batch_3.sql
packages/db/migrations/meta/0067_snapshot.json
packages/db/migrations/meta/_journal.json
```

Read the rest from the copy on your Desktop. Three STOPs, tell the lead in
each case: the `git diff --stat 476ceebc HEAD` lists a file outside `docs/`;
the `git log ... -- packages/db` prints any line; the migrations diff prints
anything else.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 67 and `newest` 1793044397504 (0066's journal stamp).
Anything else: STOP, tell the lead.

```sql
-- 0067 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** `table_present` 0,
`trigger_present` 0, `new_functions` 0, `old_function` 1,
`visible_char_config` empty (NULL). Anything else means part of this step is
already in this database: do not run step 3, tell the lead.

```sql
-- 0067 step 2 (b): the pre-check. Run this one alone.
select (to_regclass('public.sign_in_failures') is not null)::int as table_present,
       (select count(*) from pg_trigger where tgname = 'trg_memberships_role_writer') as trigger_present,
       (select count(*) from (values (to_regprocedure('public.app_sign_in_pause_seconds(text)')),
          (to_regprocedure('public.app_sign_in_failure_record(text)')),
          (to_regprocedure('public.app_membership_writer_facts()')),
          (to_regprocedure('public.enforce_membership_role_writer()'))) f(p) where p is not null) as new_functions,
       (to_regprocedure('public.enforce_same_org()') is not null)::int as old_function,
       (select proconfig from pg_proc where oid = 'public.text_has_visible_character(text)'::regprocedure) as visible_char_config;
```

(c) Nothing depends on `enforce_same_org`. Expect 0. Anything else: STOP,
tell the lead (step 3 would fail on it, and roll that file back).

```sql
-- 0067 step 2 (c): what depends on the function this step drops. Run this one alone.
select count(*) from pg_depend where refobjid = 'public.enforce_same_org()'::regprocedure;
```

(d) The grants now: 12 rows, `granted` true on every row except
`api_keys / delete` and `client_payment_claims / delete`. Anything else: tell
the lead before step 3 (it is not a STOP for the step, which converges the
grants, but it means someone granted or revoked by hand).

```sql
-- 0067 step 2 (d): the three tables' grants before. Run this one alone.
select t, p, has_table_privilege('metra_app', ('public.' || t)::regclass, p) as granted
  from unnest(array['api_keys','client_payment_claims','organizations']) t
 cross join unnest(array['select','insert','update','delete']) p order by 1, 2;
```

(e) Studios without an owner. Expect 0. It is information only: the new
trigger judges future writes, never existing rows. Write the number down.

```sql
-- 0067 step 2 (e): studios with no owner. Run this one alone.
select count(*) from public.organizations o
 where not exists (select 1 from public.memberships m where m.org_id = o.id and m.role = 'owner');
```

(f) Live API keys whose creator is no longer a member (orphaned before push 1
began revoking them), and live keys whose creator now holds the client role.
Write both numbers down; step 4 (f) uses the first.

```sql
-- 0067 step 2 (f): keys left live by a removed or client-role creator. Run this one alone.
select count(*) filter (where m.user_id is null) as orphaned_live_keys,
       count(*) filter (where m.role = 'client') as client_creator_keys
  from public.api_keys k
  left join public.memberships m on m.org_id = k.org_id and m.user_id = k.created_by
 where k.revoked_at is null;
```

(g) Expect `policies` 81 and `restrictive` 15.

```sql
-- 0067 step 2 (g): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (see *Locks*). Each line runs its command only if the one before
it exited 0:

```powershell
npm run db:migrate
if ($LASTEXITCODE -eq 0) { npm run db:apply-rls }
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

**NOTICE blocks are normal.** Any `message:` line that ends
`does not exist, skipping` or `already exists, skipping` is routine:

- `db:migrate`: the same two as every run (`schema "drizzle" already exists, skipping`
  and `relation "__drizzle_migrations" already exists, skipping`).
- `db:apply-rls`: the same four as every run (step D's runbook lists them),
  and two new ones on this FIRST run, both in `policies/00-core.sql`:
  `message: 'policy "no_direct_access" for relation "public.sign_in_failures" does not exist, skipping',`
  (just before the `self_memberships` one) and
  `message: 'trigger "trg_memberships_role_writer" for relation "public.memberships" does not exist, skipping',`
  (just after it). A RE-RUN prints neither of those two and prints one other,
  first of all: `message: 'function public.enforce_same_org() does not exist, skipping',`.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. Step 4 (a) is its count.
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `67 tables, 82 policies, 37 triggers, 105 functions, RLS forced on all of them, role metra_app present.`
  The second starts `apply-rls: grants verified`, names **28 narrowed
  table(s)** (step D's said 24: `api_keys`, `client_payment_claims`,
  `organizations` and `sign_in_failures` are the four new names) and, before
  its last two clauses, now says
  `client_payment_claims updatable on its 5 answer columns only; api_keys updatable on its 2 revoke columns only`.
  If that second line is replaced by a problem list, it exits 1: do not merge,
  tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, each starting
  `assert-schema-applied:`, in this order: `OK` then
  `67 declared table(s), every column present.`; `indexes` then
  `152 declared, all present.`; `constraints` then `415 declared, all present.`;
  `functions` then `105 declared, all present.`; `orphaned org rows` then
  `58 org-scoped table(s) answered, none holds a row whose org_id names no organization.`;
  and `composite set-null FKs` then
  `16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**A lock race in `db:apply-rls` is retried for you,** and a command that
fails prints the SQLSTATE and what to do, exactly as in step D's runbook
(its step 3): `55P03` or `40P01` means re-run `npm run db:apply-rls` until it
exits 0, then `npm run assert-schema-applied -w @metra/db`; any other code
ends `tell the lead before running anything else`. Two codes are specific to
this step:

- `Migration failed: SQLSTATE 42P07: relation "sign_in_failures" already exists`:
  part of this step is already in this database, which step 2 (b) would have
  shown. Nothing changed; tell the lead.
- `apply-rls failed: SQLSTATE 2BP01` naming `enforce_same_org`: something
  depends on the function, which step 2 (c) would have shown. That file rolled
  back; tell the lead.

**Safe to re-run.** `db:migrate` records 0067 only when it commits; after a
success it finds nothing pending. Every statement under `rls/` is idempotent.
`assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0067 as ONE transaction that creates a new, empty
table and changes one setting of one function: it takes no lock on any
existing table, so no request waits on it. `db:apply-rls` runs every file as
it always does (the worst cases in step B's runbook are unchanged). Two files
do something new: `policies/00-core.sql` takes its usual ACCESS EXCLUSIVE lock
on `memberships` for the policy and now also creates the trigger under it (3 s
per lock wait, then the file rolls back and is tried again), and `rls/roles.sql`
changes three tables' grants inside its one transaction, so no request ever
sees the moment between a revoke and its grant.

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` 68, `newest` 1794600321580 (0067's journal
stamp).

(b) Step 2 (b) again: now `1, 1, 4, 0` and `visible_char_config`
`{search_path=""}`.

(c) Step 2 (d) again: `granted` is now false for `api_keys / update`,
`api_keys / delete`, `client_payment_claims / insert`,
`client_payment_claims / update`, `client_payment_claims / delete` and
`organizations / delete`, and true for the other six. Then this block: one
row, `t, t, f, f, t, f`.

```sql
-- 0067 step 4 (c): the column grants, and the new table closed to metra_app. Run this one alone.
select has_column_privilege('metra_app', 'public.api_keys'::regclass, 'revoked_at', 'update') as key_revoked_at,
       has_column_privilege('metra_app', 'public.api_keys'::regclass, 'updated_at', 'update') as key_updated_at,
       has_column_privilege('metra_app', 'public.api_keys'::regclass, 'created_by', 'update') as key_created_by,
       has_column_privilege('metra_app', 'public.client_payment_claims'::regclass, 'claimed_amount', 'update') as claim_amount,
       has_column_privilege('metra_app', 'public.client_payment_claims'::regclass, 'status', 'update') as claim_status,
       has_table_privilege('metra_app', 'public.sign_in_failures'::regclass, 'select') as sign_in_table;
```

(d) Step 2 (g) again: `policies` 82 and `restrictive` 15.

(e) The new table is empty. Expect 0.

```sql
-- 0067 step 4 (e): the new table. Run this one alone.
select count(*) from public.sign_in_failures;
```

(f) **Only if step 2 (f) gave `orphaned_live_keys` above 0:** close them
once. It must report that same number of rows; if it reports another, tell
the lead. (Keys of client-role creators are left alone: the app now refuses
them at the door, and they work again if the role changes back.)

```sql
-- 0067 step 4 (f): revoke the live keys whose creator is no longer a member. Run this one alone.
update public.api_keys k set revoked_at = now(), updated_at = now()
 where k.revoked_at is null
   and not exists (select 1 from public.memberships m where m.org_id = k.org_id and m.user_id = k.created_by);
```

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still
runs the current `main`. About five minutes, in your own studio only, with the
log open in a second window (`npx wrangler tail metra-web` from
`C:\Users\HP\merta-main\apps\web`):

- sign in, and open the **Team** page (الفريق);
- as owner, change a test member's role, then change it back;
- open a client's **Documents** tab and delete a test upload;
- open **Settings**, then API keys: the list loads; mint a test key and revoke it.

Expected: each one works as before, and the log shows no `MT150`, no `42501`,
no `42883` and no `mutateInOrg failed`. **If anything fails:** do not merge.
Run the undo below now, then tell the lead what you saw.

**6. Then: merge, and return the checkout to main.** Tell the lead steps 1 to
5 are done; the lead merges the branch. Its deploy changes no behaviour (the
sign-in pause arrives with push 3, which has its own smoke test). Then:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**7. Later, with push 3: lifting a sign-in pause.** Not part of this step.
Once push 3 is live, ten wrong codes for one email or phone pause its sign-in
for up to an hour. To lift one early, in the Supabase SQL editor (the email
trimmed and in lower case; a phone as `+` and digits):

```sql
-- Lift one sign-in pause. Replace the address, keep the 'sign-in:' prefix.
delete from public.sign_in_failures
 where identifier_hash = encode(sha256(convert_to('sign-in:' || 'user@example.com', 'UTF8')), 'hex');
```

**Undo, if ever needed.** Step 5 fails, or before the merge the log shows an
`MT150` or a `42501`. Two parts, in this order, at a quiet hour.

Part 1, in the Supabase SQL editor, on its own. It removes the two objects
the previous database code would trip on or leave active: the trigger, and
the policy (the previous code reports a policy it does not declare as a
failure; the table stays closed without it, because RLS is forced on it).

```sql
-- 0067 undo, part 1. Run this one alone.
set lock_timeout = '3s';
drop trigger if exists trg_memberships_role_writer on public.memberships;
drop policy if exists no_direct_access on public.sign_in_failures;
```

Part 2, the previous database code's `db:apply-rls`, from `main` as it was
before this branch (`73d3433d`). It grants the three tables' old table-level
privileges back and re-creates `enforce_same_org`:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach 73d3433d
git log --oneline -1    # 73d3433d merge: security fix round, batch 3 push 1 (validate/sec-batch-3-app)
npm run db:apply-rls
```

Expected: it exits 0 with step D's two verified lines
(`66 tables, 81 policies, 36 triggers, 102 functions ...` and 24 narrowed
tables). Then step 5 again, put the checkout back on main (step 6), and tell
the lead what failed the first time. Do not merge.

0067 itself is not undone: the previous code never touches the new table, and
the `search_path` setting changes no answer. The four new functions stay,
unused. To go forward again, only when the lead says so: step 1, then from
step 3 only `npm run db:apply-rls` and `npm run assert-schema-applied -w @metra/db`,
then step 4 and on.
