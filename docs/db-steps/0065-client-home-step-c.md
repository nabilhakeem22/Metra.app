# Client home DB step C (0065, the client's one page): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

The client home's database step: migration `0065_client_home.sql` plus
`db:apply-rls` (two new files under `rls/functions/`, one under
`rls/policies/`, and changes to five existing files and `rls/roles.sql`). It
runs AFTER Stage 2 DB step B ([its runbook](0064b-stage-2-step-b.md)): production then holds 65
migrations and 80 policies, 15 of them restrictive; step C leaves it at 66
and 81. It is validated on branch `validate/home-h3-sql`, whose code is
pinned at **`31e21c8f`**: the branch's last code commit (every commit after it
changes only `docs/DEPLOY.md`). That branch is `main` (`65c78473`: Stage 2,
the site diary and step B) plus PR H3, its two fix rounds and the code cleanup of
`validate/cleanup-oct26` (`6ed20154`, no database change).

**Step C is not the last client home step.** DB step C2 (apply-rls only)
comes later, with the next scheduled database step after PR H7 is live: the
four old client acts (`app_contract_ack_by_token` and
`app_variation_respond_by_token` for BOQ contracts, and the two "I paid"
functions) will then answer `moved` unless a code was checked first. Its
runbook is written then; step C changes none of those four answers.

**THE ORDER (do not change it):**

0. **Already done:** Stage 2 **DB step B**, run from its pin `4cf2a68a` with
   its step 4 as expected (`main`'s `packages/db` is that code, byte for
   byte). Step 1 checks the code; check yourself that you ran step B.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs the new database code:** the delivery cockpit's
  execution card, the contract page's stage, the Payments tab, the final
  account and the payment request cores now read the execution facts through
  new database functions (one source the client home will share), and issuing
  a change order now restarts its client link's 30 days, which the old
  change-order guard refuses (MT100). On the old database those pages fail
  with 42883 and the issue with MT100.
- **The current Worker is safe on the new database, with no visible
  difference:** 0065 only adds (two columns with a default, two checks, one
  index, one empty table), and this `db:apply-rls` keeps every answer the
  current code gets. Five client functions are rewritten to share one helper
  each, and answer byte for byte what they did (rehearsed: an md5 of every
  contract link, change-order link, delivery link and execution card document
  identical before and after); the delivery link's answer gains one key,
  `entry_phase` (`design` for every delivery today), which the current code
  does not read (its mapper picks the keys it knows, and a test pins that);
  the change-order guard admits everything the old
  one did; a delivery's execution contract is now also found by its project
  for a "light" delivery, of which none exists until PR H4. One rule moves for
  the execution card and the "I paid" behind it: they now stand on the
  delivery's contract by the rule the studio's cockpit uses, so a delivery
  whose terminated contract a newer issued BOQ replaced, or whose BOQ was made
  for another client of the project, shows what its cockpit shows. Step 2 (g)
  counts those deliveries, and the BOQs made for another client; production
  should have none of either. Rehearsed: the
  current `main`'s own isolation gate and action tests on the step C database
  (see *Rehearsed*).
- **No client sees anything new** until PR H4: the new client functions have no
  caller in the current code, and the codes table stays empty.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `design_engagements` | one new column, `entry_phase` (`design` for every delivery, the default; `execution` for a LIGHT delivery, the client page of an execution contract with no design delivery behind it, created from PR H4), two checks (only those two values; a light delivery is at `execution` and stays there), and one unique index (at most one light delivery per project and client) |
| `variation_order_events` | one new column, `recorded_on_paper` (false for every event, the default; true, from PR H7, on a client's change-order decision the studio records from a paper document the client signed) |
| `client_verification_codes` (new, empty) | one row per one-time code a client asks for (from PR H5): which delivery, which act and which document, the HASH of the code (never the code), where it was sent (a hash and a hint of the address), the client's ip and browser, and what it was used for. Ten minutes of life and five tries, by check. RLS enabled and forced from the moment it exists |
| `rls/functions/65-execution-facts.sql` (new) | the execution facts, ONE source for the studio's cockpit and the client's page: which BOQs a delivery owns (only its own client's; a light delivery's by its project), THE contract it stands on (one rule for the studio and the client), a contract's money facts, its measured lines and works, and everything the execution card is derived from. The studio reads them as itself, under its own RLS |
| `rls/functions/75-client-home.sql` (new) | the client home (from PR H4): the page by its delivery link, its contract and change orders through the SAME functions as the contract and change-order links (so the document a client signs is the same), the one-time code request with its limits (60 s between codes for one document, 5 an hour for it, no new one for it after 15 wrong tries on its codes in an hour, 10 a day per delivery, 25 a day per studio, 80 a day across the platform; it also removes codes never used, 90 days after they expired, and keeps every used one), the four acts that will need a code (each answers `busy`, not an error, when a studio write holds what it needs), and where an old contract or change-order link sends its holder; plus their internal helpers and the codes table's guard |
| `rls/functions/40-delivery-read.sql` | the delivery link's answer gains `entry_phase` (`design`, or `execution` for a light delivery, from PR H4), so the client page knows a light delivery from the read it already makes; every other key is unchanged |
| `rls/functions/30-contracts-variations.sql`, `50-delivery-write.sql`, `70-execution-portal.sql` | the contract and change-order links, the two "I paid" functions and the execution card share four new helpers (how a contract was signed, the days approved change orders add, what is still due on a request, on a design instalment), with the same answers; the execution card stands on the delivery's contract by the cockpit's rule (a light delivery's found by its project; see step 2 (g)); the change-order guard is now its own function: everything it admitted before, plus issue restarting the link's 30 days; the change-order link reads a rejection recorded from the client's paper as the client's (none exists until PR H7) |
| `rls/policies/36-client-home.sql` (new), `policies/30-contracts-boqs-variations.sql` | the codes table's org isolation policy and guard trigger (a code changes only by one wrong try or its one use; it is deleted only with its delivery, or, never used, 90 days after it expired); the change-order trigger points at the new guard |
| `rls/roles.sql` | `metra_app` may read every column of the codes table but the code's hash, and write none of it (only the client home's own functions do); the new functions are callable by `metra_app` only, the helpers that take bare ids by nobody |

**1. Put the step C code in the production checkout.** This step adds no
dependency of `db:migrate` or `db:apply-rls`, so the installed `node_modules`
serve as they are. Right after the switch it saves a copy of this runbook:
the checkout undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/home-h3-sql
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-c.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 31e21c8f HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (31e21c8f)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --name-only 65c78473 HEAD -- packages/db/migrations    # MUST print exactly the three 0065 files below
```

The last command must print exactly these three lines, in this order:

```
packages/db/migrations/0065_client_home.sql
packages/db/migrations/meta/0065_snapshot.json
packages/db/migrations/meta/_journal.json
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Four
STOPs, tell the lead in each case:

- The `git diff --stat 31e21c8f HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything else: this runbook covers 0065 only.
- You ran step B from a pin other than `4cf2a68a`, or have not run it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 65 and `newest` 1792880198159 (0064's journal stamp).
Anything else: STOP, tell the lead.

```sql
-- Step C step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything else
means part of step C is already in this database: do not run step 3, tell the
lead.

```sql
-- Step C step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'design_engagements' and column_name = 'entry_phase')
        or (table_name = 'variation_order_events' and column_name = 'recorded_on_paper'))) as step_c_columns,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('client_verification_codes', 'design_engagements_one_light_per_project_client')) as step_c_relations,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_delivery_boqs', 'app_delivery_current_contract', 'app_contract_measured_lines',
                        'app_contract_measured_works', 'app_contract_money_facts', 'app_execution_flow_source',
                        'app_payment_request_due', 'app_engagement_milestone_due', 'app_contract_signed',
                        'app_contract_time_extension_days', 'app_contract_terminated_at', 'enforce_variation_order_frozen',
                        'enforce_client_code_guarded', 'app_home_delivery', 'app_home_contract', 'app_home_flow_source',
                        'app_client_code_destination', 'app_email_hint', 'app_client_code_check',
                        'app_client_code_refusal', 'app_client_code_consume', 'app_home_by_token',
                        'app_home_contract_by_token', 'app_home_contract_sections_by_token',
                        'app_home_contract_section_lines_by_token', 'app_home_variations_by_token',
                        'app_home_code_issue_by_token', 'app_home_contract_ack_by_token',
                        'app_home_variation_respond_by_token', 'app_home_claim_request_by_token',
                        'app_home_claim_design_payment_by_token', 'app_client_home_target_by_token')) as step_c_functions,
  (select count(*) from pg_trigger where tgname = 'trg_client_verification_codes_guarded') as code_trigger,
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'trg_variation_orders_immutable' and p.proname = 'enforce_variation_order_frozen') as change_order_guard;
```

(c) The sizes. Note the five numbers; step 4 (e) expects the same.
`light_candidates` are the execution contracts no delivery stands behind: PR
H4 gives each a light delivery when the studio next opens its client page.
`change_orders_to_issue` are approved inside the studio and not yet sent: from
the merge on, issuing one gives the client a full 30 days from that day.

```sql
-- Step C step 2 (c): the sizes. Run this one alone.
select (select count(*) from public.design_engagements) as deliveries,
       (select count(*) from public.design_engagements where state = 'execution') as deliveries_at_execution,
       (select count(*) from public.contracts c join public.boqs b on b.org_id = c.org_id and b.id = c.source_boq_id
         where b.engagement_id is null and c.status in ('issued', 'signed')) as light_candidates,
       (select count(*) from public.variation_orders where status = 'internal_approved') as change_orders_to_issue,
       (select count(*) from public.contracts where token_hash is not null and status in ('issued', 'signed')) as contract_links;
```

(d) What every client link shows now, as one fingerprint per kind. Note the
four values; step 4 (f) expects the same four (a client who signs, answers or
says "I paid" in between changes one: then tell the lead which). The
delivery links are fingerprinted without `entry_phase`, the one key step C
adds to them (step 4 (h) checks it), so the four compare before and after.

```sql
-- Step C step 2 (d): what the client links show, fingerprinted. Run this one alone.
select
  (select md5(coalesce(string_agg(md5(coalesce(public.app_contract_by_token(c.token_hash)::text, '')), '' order by c.id), ''))
     from public.contracts c where c.token_hash is not null) as contract_links,
  (select md5(coalesce(string_agg(md5(coalesce(public.app_variation_by_token(v.token_hash)::text, '')), '' order by v.id), ''))
     from public.variation_orders v where v.token_hash is not null) as change_order_links,
  (select md5(coalesce(string_agg(md5(coalesce((public.app_delivery_by_token(d.token_hash) - 'entry_phase')::text, '')), '' order by d.id), ''))
     from public.design_engagements d where d.token_hash is not null) as delivery_links,
  (select md5(coalesce(string_agg(md5(coalesce(public.app_delivery_execution_by_token(d.token_hash)::text, '')), '' order by d.id), ''))
     from public.design_engagements d where d.token_hash is not null) as execution_cards;
```

(e) Expect `policies` 80 and `restrictive` 15 (step B's step 4 (f)). Step 4
(g) expects 81 and 15.

```sql
-- Step C step 2 (e): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(f) The database size. Write the number down; step 4 (i) reads it again.

```sql
-- Step C step 2 (f): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

(g) **The execution cards step C changes. Expect one row, `cards_changed` 0
and `boqs_other_client` 0.** `cards_changed` counts the deliveries at
execution whose execution card (and the "I paid" behind it) step C points
at another contract, or at none: a terminated contract that a newer issued
BOQ replaced, or a BOQ made for another client of the project.
`boqs_other_client` counts the BOQs a delivery at execution holds that were
made for another client of its project (the project's client changed while
the delivery ran), with a contract or not: from step C on, the delivery no
longer owns them, so its cockpit loses them (the merged code makes every new
one the delivery client's). Anything else: STOP before step 3 and tell the
lead both numbers.

```sql
-- Step C step 2 (g): the execution cards step C changes. Run this one alone.
select (
select count(*)
from public.design_engagements de
left join lateral (
  select c.id from public.boqs b
    join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id
   where b.org_id = de.org_id and b.engagement_id = de.id and c.status in ('issued', 'signed', 'terminated')
   order by (c.status = 'terminated'), c.created_at desc, c.id desc
   limit 1
) shown_now on true
left join lateral (
  select c.id, c.status, c.source_boq_id from public.boqs b
    join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id
   where b.org_id = de.org_id and b.engagement_id = de.id and b.client_id = de.client_id
   order by (c.status = 'terminated'), c.created_at desc, c.id desc
   limit 1
) newest on true
left join lateral (
  select b.id from public.boqs b
   where b.org_id = de.org_id and b.engagement_id = de.id and b.client_id = de.client_id and b.status = 'issued'
   order by b.created_at desc, b.id desc
   limit 1
) issued_boq on true
where de.state = 'execution'
  and shown_now.id is distinct from (
    case when newest.status = 'draft' or (newest.status = 'terminated' and issued_boq.id <> newest.source_boq_id)
         then null else newest.id end
  )
) as cards_changed,
(
select count(*)
from public.design_engagements de
join public.boqs b on b.org_id = de.org_id and b.engagement_id = de.id
where de.state = 'execution'
  and b.client_id <> de.client_id
) as boqs_other_client;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*). Each
line runs its command only if the one before it exited 0, so a failure stops
the block there (a `db:apply-rls` on a database without 0065 would apply half
of its files and then fail):

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
- `db:apply-rls`, in this order: the same first four as every run
  (`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
  then TWO new ones, once only:
  `message: 'policy "org_isolation" for relation "public.client_verification_codes" does not exist, skipping',`
  and `message: 'trigger "trg_client_verification_codes_guarded" for relation "public.client_verification_codes" does not exist, skipping',`.
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (66).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `66 tables, 81 policies, 36 triggers, 100 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 24 narrowed table(s) (boqs, client_verification_codes, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; contract_cost_entries updatable on its 15 entry and void columns only; contract_payment_claims updatable on its 5 answer columns only; client_verification_codes readable on every column but code_hash; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand (or step B is missing). Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, each starting
  `assert-schema-applied:`, in this order: `OK` then `66 declared table(s), every column present.`;
  `indexes` then `150 declared, all present.`; `constraints` then
  `413 declared, all present.`; `functions` then `100 declared, all present.`;
  `orphaned org rows` then
  `58 org-scoped table(s) answered, none holds a row whose org_id names no organization.`;
  and `composite set-null FKs` then
  `16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/30-contracts-boqs-variations.sql rolled back with SQLSTATE 55P03 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/30-contracts-boqs-variations.sql ... (attempt 2 of 3)`
is NOT a failure: that one file rolled back whole and is being applied again
(3 attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0065: could not take every lock within 3 s (stopped at public.design_engagements:ACCESS EXCLUSIVE)`
  (the table named may be `organizations` or `variation_order_events`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its three locks ALL OR NONE (see *Locks*): it tries for
  all three at once, lets go of the ones it got when another table is busy,
  and tries again, for 3 s in all. This line means the named table never came
  free in those 3 s: a long query or transaction held it, or requests kept it
  busy without a gap. It held nothing while it tried, so no request waited on
  it, and the block ran nothing after it. Re-run the block a little later.
  Rehearsed: a reader holding
  `design_engagements` for 10 s gave exactly these two lines after 5.4 s,
  `migrations` stayed 65, step 2 (b) still read all 0, and the re-run after
  the reader finished applied 0065.
- `apply-rls failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row. The cause is NOT a
  broken database (the block skipped `assert-schema-applied`): a 55P03 is a
  studio transaction or report that held a table for more than 3 s (step C's
  own files touch `variation_orders` in
  `policies/30-contracts-boqs-variations.sql` and the new codes table, as well
  as the tables every run touches); a 40P01, almost always at
  `Applying policies/00-core.sql ...`, is ordinary studio traffic (step B's
  runbook says why). **Run `npm run db:apply-rls` again, and keep re-running it
  until it exits 0** (wait a minute between runs; it is safe, every statement is
  idempotent), then `npm run assert-schema-applied -w @metra/db`. The run
  that exits 0 prints the two new notices of step 3 if the failed run did not
  get past `policies/36-client-home.sql`. Until a run exits 0, the new
  functions may exist while the change-order trigger is still the old one and
  the codes table has no policy
  yet: the current site works on that (it calls none of the new functions,
  and the old trigger is what it was written for), `metra_app` reads nothing
  in the forced codes table, and nothing writes it. In between, step 2 (b) may
  show `step_c_functions` 32 with `code_trigger` 0 and `change_order_guard` 0.
  Rehearsed: see *Rehearsed* below.
- `Migration failed: SQLSTATE 42701: column "entry_phase" of relation "design_engagements" already exists`
  (or `42P07` or `42710`, "already exists", for a table, an index or a
  constraint) then
  `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of step C is already in this database, which step 2 (b) would have
  shown. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0065 only when the whole batch
commits, so after any failure a re-run starts again from 0064; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0065 as ONE transaction. It first takes every lock
it needs, ALL OR NONE, within ONE 3 s budget for all its attempts together:
ACCESS EXCLUSIVE (no reads, no writes) on `design_engagements`, SHARE ROW
EXCLUSIVE (reads go on, writes wait) on `organizations` (the new table's
foreign key) and ACCESS EXCLUSIVE on `variation_order_events` (its new
column). Each attempt asks for all three without waiting; if one is busy it
lets go of the others, sleeps 10 to 40 ms and tries again, so it never holds
one of them while it waits for another (a studio save reads the membership,
then the studio row). Then, holding them, it adds the two columns (no
rewrite: a constant default), checks the two new checks over every delivery
(one scan each), builds the light-delivery index, and creates the empty
table. A change-order page waits for this window too. `design_engagements`
is read by every delivery page, a client's link included, so those pages
wait for this window, briefly: the whole
migration took 22 to 128 ms (median 24) on a quiet local server and 22 to 110
ms (median 52) beside about 220 studio and client requests a second, 30 of 30
runs clean, 0 deadlocks, 0 failed requests, the slowest request 183 ms.
With the change-order column and its third lock (H3 round 2), the file ran
in 13 to 67 ms (median 14) on a quiet local server at this rehearsal's size
(21 deliveries, 10 runs); the figures beside traffic were not measured again.
Supabase is slower than a local server (a window measured there earlier was
0.5 to 1.9 s), so a delivery page can wait about 1 s; none fails because of it.
Estimates from a local server, not a production measurement; step 2 (c) gives
the size to compare with (the H3 build's rehearsal, where these figures come from, had 61 deliveries; production has fewer).
`db:apply-rls` adds one policy file on the new table (nothing waits on it),
re-creates the change-order trigger in `policies/30-contracts-boqs-variations.sql`
exactly as every run already does, and runs every other file as it always does
(the worst cases in step B's runbook are unchanged); a file that loses a lock
race is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` 66, `newest` 1792976742588 (0065's journal
stamp).

(b) Step 2 (b) again: now `step_c_columns` 2, `step_c_relations` 2,
`step_c_functions` 32, `code_trigger` 1 and `change_order_guard` 1.

(c) The codes table: one row, with `rls` true, `forced` true, `policies` 1,
`app_reads` true, `app_reads_code_hash` false, `app_writes` false,
`api_roles_read` false, `triggers` 1 and `codes` 0.

```sql
-- Step C step 4 (c): the codes table's RLS, grants and trigger. Run this one alone.
select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_any_column_privilege('metra_app', c.oid, 'select') as app_reads,
       has_column_privilege('metra_app', c.oid, 'code_hash', 'select') as app_reads_code_hash,
       (has_table_privilege('metra_app', c.oid, 'insert') or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete')) as app_writes,
       coalesce((select bool_or(has_any_column_privilege(r.oid, c.oid, 'select')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated')), false) as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers,
       (select count(*) from public.client_verification_codes) as codes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'client_verification_codes';
```

(d) Who may call the step C functions: 32 rows. `public_execute` false and
`api_roles_execute` false on all 32. `definer` true on eleven: the ten
`app_home_..._by_token` functions (`app_home_by_token` among them) and
`app_client_home_target_by_token`; false on the other twenty-one.
`app_execute` true on those eleven, on the six fact functions
(`app_delivery_boqs`, `app_delivery_current_contract`,
`app_contract_measured_lines`, `app_contract_measured_works`,
`app_contract_money_facts`, `app_execution_flow_source`) and on the two
trigger functions (`enforce_client_code_guarded`,
`enforce_variation_order_frozen`); false on the other thirteen (internal:
nobody calls them but the functions beside them).

```sql
-- Step C step 4 (d): who may call the step C functions. Run this one alone.
select p.proname, p.prosecdef as definer,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_boqs', 'app_delivery_current_contract', 'app_contract_measured_lines',
                    'app_contract_measured_works', 'app_contract_money_facts', 'app_execution_flow_source',
                    'app_payment_request_due', 'app_engagement_milestone_due', 'app_contract_signed',
                    'app_contract_time_extension_days', 'app_contract_terminated_at', 'enforce_variation_order_frozen',
                    'enforce_client_code_guarded', 'app_home_delivery', 'app_home_contract', 'app_home_flow_source',
                    'app_client_code_destination', 'app_email_hint', 'app_client_code_check',
                    'app_client_code_refusal', 'app_client_code_consume', 'app_home_by_token',
                    'app_home_contract_by_token', 'app_home_contract_sections_by_token',
                    'app_home_contract_section_lines_by_token', 'app_home_variations_by_token',
                    'app_home_code_issue_by_token', 'app_home_contract_ack_by_token',
                    'app_home_variation_respond_by_token', 'app_home_claim_request_by_token',
                    'app_home_claim_design_payment_by_token', 'app_client_home_target_by_token')
order by 1;
```

(e) Step 2 (c) again: the same five numbers as before.

(f) Step 2 (d) again: the same four fingerprints as before (every client link
shows exactly what it showed, a delivery link but for its new `entry_phase`;
step 2 (g) was 0 and 0).

(g) Step 2 (e) again: now `policies` 81 and `restrictive` 15.

(h) Every delivery begins in design, the new checks and index are valid, and
every live delivery link says its `entry_phase`, and no change-order event
is marked as recorded on paper: one row, `not_design` 0, `valid_checks` 2,
`valid_light_index` 1, `links_phase_wrong` 0, `paper_decisions` 0.

```sql
-- Step C step 4 (h): the new column, checks and index. Run this one alone.
select (select count(*) from public.design_engagements where entry_phase <> 'design') as not_design,
       (select count(*) from pg_constraint
         where conname in ('design_engagements_entry_phase_known', 'design_engagements_light_is_execution')
           and convalidated) as valid_checks,
       (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
         where c.relname = 'design_engagements_one_light_per_project_client' and i.indisvalid) as valid_light_index,
       (select count(*) from public.design_engagements d
         cross join lateral (select public.app_delivery_by_token(d.token_hash) as link) l
         where l.link is not null and l.link ->> 'entry_phase' is distinct from d.entry_phase) as links_phase_wrong,
       (select count(*) from public.variation_order_events where recorded_on_paper) as paper_decisions;
```

(i) Step 2 (f) again: about the same size as before (the new table is empty;
the rehearsal went from 34 MB to 35 MB). Put the number in the release note.

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
   then, if it is an execution contract, its **Payments** tab (الدفعات) and its
   change-order tab. Then **Deliveries** (التسليمات) and a delivery at the
   execution stage (its cockpit shows the execution card), a project and the
   dashboard. Expected: every page loads and shows your data as before. A list
   that is suddenly EMPTY counts as a failure too.
2. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`), a change-order link (`/v/...`) or a
   delivery link (`/d/...`) you sent to yourself, open each: it shows as
   before. Only look: do not sign, approve or say you paid anything. No test
   link: skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42883`, no `MT100`,
no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (the same evening: nothing breaks while it
   waits, but the two codes should not run side by side for days).
2. Smoke test on your own studio, the log still open: the page loads of step 5
   (1) again, now on the new code; on an execution contract, also its final
   account page (الحساب الختامي) if it has one. Expected: every page loads as
   before, and the log shows no `42883`, no `42501`, no `MT100` and no
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
page). Three parts: one SQL block that takes away the one policy the previous
code does not declare (that code's own check refuses a policy it does not
declare); the `db:apply-rls` of `main` (`65c78473`, the database code
production ran on just before step 3: step B's), which puts back the five
rewritten functions, the delivery link without `entry_phase`, the execution
card without the light scope and the old change-order trigger; then one SQL
block that removes what that code does not know (the codes table's trigger
and the 32 functions). It leaves 0065 itself
alone: the two new columns, the checks, the index and the empty codes table stay
(forced, with no policy, so `metra_app` reads nothing in it; the current site
never touches it). Afterwards the database is exactly as it was before step 3,
but for those 0065 objects: rehearsed, a catalogue comparison found zero other
differences. Use it only while the site still runs the code from before the
merge: if the new code is already deployed, undo (1) the code first, then
this.

First, in the Supabase SQL editor, on its own. Expected: one row,
`client_home_policies` 0.

```sql
-- Step C undo (0), part 1: the one policy main's code does not declare. Run this one alone.
set lock_timeout = '3s';
drop policy if exists org_isolation on public.client_verification_codes;
select count(*) as client_home_policies from pg_policies
where schemaname = 'public' and tablename = 'client_verification_codes';
```

If it fails with `canceling statement due to lock timeout`, nothing was
dropped: run it again a minute later. Then, from the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach 65c78473
git log --oneline -1    # 65c78473 merge: main (site release 83279b89) into the B4 release
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; only the FIRST FOUR notices of step 3; and it ends with
the two lines that code prints, the first going on
`65 tables, 80 policies, 35 triggers, 68 functions, RLS forced on all of them, role metra_app present.`
and the second the same as step 3's WITHOUT `client_verification_codes, ` in
the table list (`23 narrowed table(s)`) and WITHOUT
`client_verification_codes readable on every column but code_hash; `. A
problem list naming `policy client_verification_codes.org_isolation` means part
1 was not run first: run it, then this again.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3 (that code retries a file for you too, the same 3 attempts): **run
`npm run db:apply-rls` again from this checkout, and keep re-running it until it
exits 0.** Any other code: stop and tell the lead.

**Do not run the SQL block below until this `db:apply-rls` has exited 0.** Run
before it (part 1 run or not), the block fails with `cannot drop function
enforce_variation_order_frozen() because other objects depend on it`
(SQLSTATE `2BP01`: the change-order trigger still uses the new guard) and
drops nothing, as the editor runs it as one transaction. The fix is the order
above: part 1, then this `db:apply-rls` until it exits 0, then the block.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step C undo (0), part 2: the objects main's code does not know. Run this one alone.
set lock_timeout = '3s';
drop trigger if exists trg_client_verification_codes_guarded on public.client_verification_codes;
drop function if exists public.app_home_by_token(text);
drop function if exists public.app_home_contract_by_token(text);
drop function if exists public.app_home_contract_sections_by_token(text, integer);
drop function if exists public.app_home_contract_section_lines_by_token(text, uuid, integer);
drop function if exists public.app_home_variations_by_token(text);
drop function if exists public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text);
drop function if exists public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text);
drop function if exists public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text);
drop function if exists public.app_client_home_target_by_token(text, text);
drop function if exists public.app_home_flow_source(uuid);
drop function if exists public.app_home_contract(text);
drop function if exists public.app_home_delivery(text);
drop function if exists public.app_client_code_destination(uuid, uuid);
drop function if exists public.app_email_hint(text);
drop function if exists public.app_client_code_check(uuid, uuid, uuid, text, text, text);
drop function if exists public.app_client_code_refusal(text);
drop function if exists public.app_client_code_consume(uuid, uuid);
drop function if exists public.enforce_client_code_guarded();
drop function if exists public.enforce_variation_order_frozen();
drop function if exists public.app_execution_flow_source(uuid);
drop function if exists public.app_contract_money_facts(uuid);
drop function if exists public.app_contract_measured_works(uuid);
drop function if exists public.app_contract_measured_lines(uuid);
drop function if exists public.app_delivery_current_contract(uuid, uuid);
drop function if exists public.app_delivery_boqs(uuid, uuid);
drop function if exists public.app_payment_request_due(uuid, uuid);
drop function if exists public.app_engagement_milestone_due(uuid, text);
drop function if exists public.app_contract_signed(uuid, uuid);
drop function if exists public.app_contract_terminated_at(uuid, uuid);
drop function if exists public.app_contract_time_extension_days(uuid, uuid);
```

Expected: `Success. No rows returned`. Run it at the same quiet hour: the
`drop trigger` locks the codes table, and the first line makes the block give
up after 3 s. If it fails with `canceling statement due to lock timeout`,
nothing was dropped (the editor runs the block as one transaction): run the
same block again a minute later, until it succeeds. Then, read-only, each
block ON ITS OWN: step 2 (b) again (now `step_c_columns` 2,
`step_c_relations` 2, and 0, 0, 0: the 0065 objects stay, the rest is gone),
step 2 (d) again (the same four fingerprints) and step 2 (e) again (80 and 15).
Then step 5 again: everything works as it did before step 3. Put the checkout
back on main (step 6 (3)) and tell the lead what failed the first time. Do not
merge. If step 5 STILL fails after undo (0), the database code was not the
cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then from
step 3 only `npm run db:apply-rls` (0065 is still applied, so `db:migrate` is
not needed; if you run it anyway it prints `Migrations applied.` and changes
nothing). Expected: the first four notices of step 3, then the same two new
ones and the same two verified lines (re-run until it exits 0, as step 3
says); then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema** (the two columns, the index and the codes table): only if
the client home is abandoned, and only while no light delivery, no code and
no paper decision exists (step 2 (b)'s companions: `select count(*) from
public.design_engagements where entry_phase = 'execution'`, `select count(*)
from public.client_verification_codes` and `select count(*) from
public.variation_order_events where recorded_on_paper`, all 0). Tell the
lead first: it is a revert of `rls/` and a new migration, never a hand edit
here.

**Rehearsed** (client home H3, its fix round and round 2, Oct 26). After round
2, every command and SQL block above was run again as written, at
`31e21c8f`, on a local PostgreSQL 17 database (UTF8) built in production's own
order:
Supabase's API roles and default grants simulated first; then `main`'s
database code at `0f9cb2db` (`db:migrate`, `db:apply-rls`, `seed`); DB step S
from `992bca1e`; DB step B's `db:apply-rls` from `65c78473` (`65 tables, 80
policies, 35 triggers, 68 functions`) and `assert-schema-applied`; then data
written by `main`'s own cores (three studios: deliveries at every execution
stage, a client's claim, change orders approved, internal and expired, a
final account, a termination, contracts no delivery stands behind) and a bulk
of ten studios: 2,023 contracts (1,015 issued or signed with a client link),
20,170 contract lines, 21 deliveries, 18 of them at execution. The runs used a
fresh clone standing in for `merta-main` (its own `npm ci`, `origin` on
GitHub, `origin/main` at `65c78473`): the PowerShell cut from this section
with three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy, each block on its own.

- Steps 1 to 4 printed exactly what they say. Step 1's guards printed only the
  `docs/DEPLOY.md` line and the three 0065 files, and the saved copy equals the
  branch's runbook. Step 2 read 65 and 1792880198159; all 0; 21, 18, 6, 3 and
  1,015; four fingerprints (the delivery links' the same as without the
  `- 'entry_phase'`, which changes nothing before step C); 80 and 15; 34 MB;
  `cards_changed` 0 and `boqs_other_client` 0. Step 3 printed the two migrate
  notices, the four and the two apply-rls notices, the two verified lines
  (compared character for character) and the six `assert-schema-applied`
  lines, and exited 0. Step 4 read 66 and 1792976742588; 2, 2, 32, 1 and 1; the
  codes table row as written; 32 rows in (d) (eleven definers, nineteen
  callable by `metra_app`, thirteen internal); the same five numbers and four
  fingerprints; 81 and 15; 0, 2, 1, 0 and 0; 35 MB. All 21 delivery links now
  carry `entry_phase`. A second step 3 printed only what *Safe to re-run* says
  and changed nothing in the catalogue.
- A catalogue comparison (every function body with its settings and grants,
  policy, trigger, table and column grant, constraint, index and RLS flag) from
  step B to step C found exactly the changes under *What it changes*: 32
  functions added; seven replaced (the contract, change-order and delivery
  links, the two "I paid" functions, the execution card and its contract
  helper); 1 policy; the codes table's trigger and the re-pointed change-order
  trigger; the codes table with its grants, constraints and indexes; the
  change-order event column (`metra_app` may insert it, by its table grant);
  nothing else.
- **The migration's lock race, on purpose.** A reader holding
  `design_engagements` for 10 s against step 3: the two 55P03 lines, exit 1,
  nothing run after them, `migrations` still 65, step 2 (b) all 0. A reader
  holding `variation_order_events` for 10 s: the same two lines, stopped at
  `public.variation_order_events:ACCESS EXCLUSIVE`, the same state. The block
  run again after the readers ended applied 0065.
- **apply-rls's lock race, on purpose.** A reader holding `variation_orders`
  for 30 s while step 3 ran (0065 then applied): `policies/30-contracts-boqs-variations.sql`
  lost three times (55P03, retried after 2 s and 4 s), the two failure lines,
  exit 1, and `assert-schema-applied` skipped; in between, step 2 (b) read 2,
  2, 32, 0 and 0. `db:apply-rls` run again after the reader ended exited 0 with
  the four and the two notices, `assert-schema-applied` exited 0, and the
  catalogue was identical to a clean run's.
- **Undo (0)**, from the saved copy. Part 2 run first, and again after part 1
  but before `main`'s `db:apply-rls`: both times `cannot drop function
  enforce_variation_order_frozen() because other objects depend on it`
  (2BP01), and step 2 (b) still read 2, 2, 32, 1 and 1: nothing dropped. Part
  1 while a reader held the codes table for 6 s: `canceling statement due to
  lock timeout`, nothing dropped; run again, 0. `main`'s `db:apply-rls` run
  before part 1 (on a second step C database): not landed, naming `policy
  client_verification_codes.org_isolation`. Then, in order: `65c78473`'s
  `db:apply-rls` printed the four notices and the two lines quoted there (the
  grants line exactly as derived) and exited 0; part 2 returned no rows; step
  2 (b) read 2, 2, 0, 0 and 0, step 2 (d) the same four fingerprints and step
  2 (e) 80 and 15; and the catalogue equalled step B's but for the 0065
  objects it keeps (the two columns among them; every function, the delivery
  and change-order links' included, as at step B).
- **Forward again** (step 1, then this branch's `db:apply-rls` only): the four
  and the two notices, the two verified lines, exit 0; step 2 (b) 2, 2, 32, 1
  and 1, the same four fingerprints, 81 and 15, step 4 (h) 0, 2, 1, 0 and 0;
  and a catalogue identical to the first forward's. Step 6 (3) then put the
  checkout back on `main`.
- **Step 2 (g) itself**, on a copy of the database at step B with three
  deliveries planted (one whose signed contract was terminated and replaced by
  a newer issued BOQ; one with a newer issued BOQ, a contract on it, made for
  another client of the project; one with an issued BOQ made for another
  client and no contract): `cards_changed` 2 (the first two) and
  `boqs_other_client` 2 (the last two; the third is the case only this column
  sees). After step C the execution card changed for exactly the first two of
  the 18 deliveries at execution, and neither of the last two owned the other
  client's BOQ any more. On the clean database both read 0.
- **The current code on the step C database:** `main`'s (`65c78473`) own
  isolation gate passed 60 of 60, and its action tests 1,699 of 1,701, on a
  copy of this step C database (both new columns in it). The two failures
  test schema objects, not an app path: one pins the list of token functions
  in the database, which step C extends; the other fails the same way on the
  step B database (it checks a Supabase default grant that the simulated
  roles add and `roles.sql` does not manage). No contract, change order
  (the termination cascade included), delivery, payment, claim, final
  account or measurement test of the shipped code failed.
- **Carried over from the H3 build's rehearsal:** the migration's lock window
  beside studio traffic under *Locks* (round 2 added the change-order column
  and a third lock; that file was measured on a quiet server only, as *Locks*
  says) and the 36 `db:apply-rls` runs beside studio traffic (the fix rounds
  changed function bodies and grants, which every run re-creates, and no
  policy file but comments).
- **This branch's own tests** on a fresh database replayed as CI does: the
  isolation gate and every action test passed (one timing test,
  `execution-transaction-bounds`, failed once while the same machine ran the
  unit suite beside it, and passed three of three on its own).
