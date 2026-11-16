# 0058 and the Round C database step: owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Round C has ONE database step, and this is it (Wave 1 had none): migration
`0058_client_page_details.sql` plus changed and new functions, one trigger
and new grants under `rls/`. It is validated on branch `validate/round-c-c7`.
The Wave 3 PRs (studio contact and payment details, the client page timeline
and gallery, the inline handover close, the hourly repair of lost
notifications) are cut only after it is merged.

**THE ORDER (do not change it):**

1. **You run the database step on production FIRST**, from the C7 branch
   (steps 1 to 4 below).
2. **Only then** does `validate/round-c-c7` merge (step 5).

Why, one sentence each:

- **C7's code before the migration is an outage:** its drizzle schema names
  seven new `organizations` columns and three new `design_engagements`
  columns, and Drizzle full-row selects list every column, so Settings, the
  dashboard, every delivery page and every client page fail with 42703
  (*Deploying before migrating* above).
- **The database step before the code is safe:** the live code never names the
  new columns, never calls the five new functions, ignores the new fields of
  the client page snapshot, and every function it calls keeps its exact
  arguments and result. Measured on a production-shaped copy: main's own 842
  database tests ran against the 0058 database and 841 passed (the one that
  failed lists every token function by name; this branch adds the two new
  ones), and 15,536 calls of the live functions over two randomly generated
  databases gave identical answers on main and on 0058 except for the one
  intended change below.

**The one thing the live code sees differently.** On a delivery that has ended
(abandoned, closed design-only, or moved to execution) with a milestone still
unpaid, the client page stops offering "I've made this payment". Today it
offers it and then refuses the claim ("this delivery is no longer active"),
so the button only ever led to an error.

**What it changes.** Additive only; no row is updated or backfilled.

| Object | Change |
|---|---|
| `organizations` + 7 columns | `studio_phone`, `studio_whatsapp`, `instapay_address`, `bank_name`, `bank_account_holder`, `bank_account_number`, `bank_iban`: all optional `text`, with 8 CHECKs (numbers are 7 to 15 digits with an optional leading `+`; InstaPay 3 to 100 characters; bank name and holder 2 to 120; InstaPay, bank name and holder need one visible character and may hold no invisible or direction-changing character; account number 4 to 34 letters, digits or `-` with at least one digit; IBAN two capital letters, two digits, then 10 to 30 capitals or digits; an account number or IBAN needs a bank name) |
| `design_engagements` + 3 columns | `client_expected_on` (`date`), `client_expected_state` (the stage it was set in) and `client_expected_set_at` (when), optional, with one CHECK: all three set or all three empty |
| `notifications_org_entity_idx` | NEW index `(org_id, entity_id)` on `notifications`: "was this client act ever notified?" reads one delivery's notifications instead of every recent one of the studio (measured locally: the hourly check over 1,000 deliveries went from 1.3 s to 0.3 s, and from 2.4 s to 0.5 s with no older notifications) |
| `trg_organizations_client_page_writer` | NEW trigger: only an owner or admin of the studio may change the seven columns above; anyone else (including a script or the SQL editor with no app session) gets SQLSTATE MT120 and nothing changes. Every other studio column is unaffected |
| `app_document_media(text)` | NEW, returns `text`: one rule for "is this file an image, a PDF or other", by its extension |
| `app_delivery_by_token(text)` | same signature and result (`jsonb`); new fields: the studio's phone and WhatsApp; the studio's payment details (ONLY while a payment is due on a delivery that is still running, and only when they name InstaPay, an account number or an IBAN); when each pending claim was sent; a dated timeline (stage moves, the client's decisions, payments received; newest 60); the decisions on file (design, handover, budget); the expected date (only while the delivery is still in the stage it was set in, has not moved since, and the date has not passed in Cairo); image/pdf/other per document. Changed: no milestone is claimable on an ended delivery |
| `app_delivery_document_by_token(text, uuid)` | same signature and result; new field `media` |
| `app_delivery_logo_by_token(text)` | NEW, returns `jsonb`: where the studio's logo is stored, for the client page (images only, the delivery's own studio only) |
| `app_delivery_close_target_by_token(text)` | NEW, returns `jsonb`: which delivery a client's handover confirmation closes (only at the handover, only after a live client confirmation) |
| `app_client_act_anchor(uuid, uuid, text, text)` | NEW, internal, returns `timestamptz`: when a client act happened. Executable by NO app role; only the two functions below call it |
| `app_delivery_act_notified_by_token(text, text, text)` | same signature, result and answers; now reads the shared rule above |
| `app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)` | NEW, returns `jsonb`: the hourly repair of a studio notification lost on a client's first tap. Refuses anyone but an owner or admin of the org it runs in; notifies studio members only, never the client; skips an act nobody would hear about |
| grants | the four app-facing new functions and the trigger function: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated`, `service_role` in the same transaction that creates them (and again in `roles.sql`); `app_client_act_anchor`: revoked from all of those AND `metra_app`; the column-level UPDATE grant on `design_engagements` goes from 16 to 19 columns (the three new ones) |
| `anon`, `authenticated` | lose every grant on every table and sequence in `public`, and the default grants for tables and sequences created later. The app never uses them (it talks to Postgres directly; Supabase serves only Auth and Storage, in their own schemas), so nothing in the app changes; if the Data API is ever switched back on, it reaches nothing here |

**1. Put the C7 code in the production checkout.** Detach onto the branch (it
is checked out in another worktree). This step changes no dependency
(`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-c-c7
git log --oneline -1    # must be the SHA the lead gave you for this run, with green CI
```

**2. Read-only, before** (Supabase SQL editor). Note the numbers:

```sql
-- (a) migrations recorded so far: expect 58, and newest 1791342035319 (0057)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (b) how big the three tables the migration locks are
select (select count(*) from organizations)      as studios,
       (select count(*) from design_engagements) as deliveries,
       (select count(*) from notifications)      as notifications;

-- (c) 0 rows: none of the ten new columns exists yet
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and column_name in ('studio_phone', 'studio_whatsapp', 'instapay_address', 'bank_name',
                      'bank_account_holder', 'bank_account_number', 'bank_iban',
                      'client_expected_on', 'client_expected_state', 'client_expected_set_at');

-- (d) 9 rows today. Keep this output: step 4 runs it again.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1;

-- (e) 0 rows: none of the new functions exists yet
select proname from pg_proc
where proname in ('app_document_media', 'app_delivery_logo_by_token',
                  'app_delivery_close_target_by_token', 'app_client_act_anchor',
                  'app_notify_lost_client_acts', 'enforce_client_page_details_writer');

-- (f) grants the API roles hold today on public tables and sequences. Note the
-- number (on Supabase it is normally in the hundreds); step 4 expects 0.
select count(*) as api_role_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join lateral aclexplode(c.relacl) a
join pg_roles r on r.oid = a.grantee
where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  and r.rolname in ('anon', 'authenticated');
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected (both commands also print routine NOTICE blocks with a `code:` field,
such as 42P06, 42P07, or "trigger ... does not exist, skipping" on the first
0059 apply-rls; those are normal. Only a line that starts `Migration failed:`
or `apply-rls failed:` is a failure):

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so re-run query (a) from step 2: `migrations` is exactly one higher
  (59) and `newest` is `1791583616467` (0058's journal stamp).
- `db:apply-rls` ends with these two lines (printed from the committed `rls/`
  files, so they are the same on every database; CI's apply-rls step verified
  exactly these counts on this branch, and a production-shaped rehearsal
  printed them verbatim, twice):
  `apply-rls: verified in the catalogues — 46 tables, 46 policies, 14 triggers, 43 functions, RLS forced on all of them, role metra_app present.`
  and
  `apply-rls: grants verified — design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0, and its functions line reads
  `assert-schema-applied: functions — 43 declared, all present.` (its index
  and constraint lines are report only and do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations`, `design_engagements` or `notifications`
  for more than 3 s. Re-run `db:migrate` a little later. The same two codes
  from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  This cannot come from the rows you have (all ten columns are new and
  empty); if it appears anyway, do not re-run: tell the lead.
- Any other code ends `tell the lead before running anything else`.

If `db:apply-rls` is run BEFORE `db:migrate`, it stops at
`40-delivery-read.sql` (the snapshot function reads the new studio columns,
and a `language sql` body is checked against the columns when it is created)
and prints
`apply-rls failed: SQLSTATE 42703: column o.studio_phone does not exist`
then
`apply-rls failed: a column is missing because db:migrate has not run: run db:migrate, then db:apply-rls again; nothing is broken (this file rolled back; the files before it stay applied).`
Do exactly that: both are re-runnable. (Rehearsed: this exact output, then
`db:migrate` and `db:apply-rls` green.)

**Locks.** `db:migrate` runs 0058 as ONE transaction:

- ACCESS EXCLUSIVE on `organizations` from its first ADD COLUMN until the
  commit, with one scan of it for each of its eight CHECKs, then ACCESS
  EXCLUSIVE on `design_engagements` with one scan for its CHECK, then SHARE on
  `notifications` while the index builds (new notifications and mark-as-read
  wait; reading the bell does not). Almost every studio page reads
  `organizations`, so every page and every client page opened in that window
  waits; none fails.
- Taking each lock after the previous one, it can meet an app transaction that
  holds a later table and wants an earlier one: Postgres then cancels one side
  with 40P01 (deadlock). If it cancels the migration, the batch rolls back and
  the output says to re-run (above).
- With the counts from step 2 (b) this is well under a second against the
  migrator's 3 s `lock_timeout`. It is an estimate, not a production
  measurement.

`db:apply-rls` replaces functions without table locks; creating the new
trigger takes a brief lock on `organizations`; the policy files are the 33 s
worst case described above.

**4. Read-only, after: expected results.**

```sql
-- 10 rows:
--   design_engagements | client_expected_on     | date                     | YES
--   design_engagements | client_expected_set_at | timestamp with time zone | YES
--   design_engagements | client_expected_state  | USER-DEFINED             | YES
--   organizations      | bank_account_holder    | text                     | YES
--   organizations      | bank_account_number    | text                     | YES
--   organizations      | bank_iban              | text                     | YES
--   organizations      | bank_name              | text                     | YES
--   organizations      | instapay_address       | text                     | YES
--   organizations      | studio_phone           | text                     | YES
--   organizations      | studio_whatsapp        | text                     | YES
select table_name, column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public'
  and column_name in ('studio_phone', 'studio_whatsapp', 'instapay_address', 'bank_name',
                      'bank_account_holder', 'bank_account_number', 'bank_iban',
                      'client_expected_on', 'client_expected_state', 'client_expected_set_at')
order by 1, 2;

-- 9
select count(*) from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_instapay_address_length', 'organizations_bank_text_length',
                  'organizations_bank_account_number_format', 'organizations_bank_iban_format',
                  'organizations_bank_account_needs_bank', 'organizations_payment_text_printable',
                  'design_engagements_client_expected_together');

-- 1 row: t | CREATE INDEX notifications_org_entity_idx ON public.notifications USING btree (org_id, entity_id)
select i.indisvalid, pg_get_indexdef(i.indexrelid)
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname = 'notifications_org_entity_idx';

-- 1 row: trg_organizations_client_page_writer | O
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.organizations'::regclass
  and tgname = 'trg_organizations_client_page_writer';

-- 6 rows, public_grants = 0 and anon = authenticated = service_role = false on every row;
-- metra_app = true on five rows and FALSE on app_client_act_anchor (internal, no app grant)
select f.sig,
       has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values
  ('public.app_document_media(text)'),
  ('public.app_delivery_logo_by_token(text)'),
  ('public.app_delivery_close_target_by_token(text)'),
  ('public.app_client_act_anchor(uuid, uuid, text, text)'),
  ('public.app_notify_lost_client_acts(timestamp with time zone, timestamp with time zone, jsonb)'),
  ('public.enforce_client_page_details_writer()')
) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- Step 2 (d) again. 11 rows: every row from before is IDENTICAL, and there are
-- exactly two new ones (marked NEW):
--   app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
--   app_delivery_by_token                   | p_hash text | jsonb
--   app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_close_target_by_token      | p_hash text | jsonb   (NEW)
--   app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
--   app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
--   app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
--   app_delivery_logo_by_token              | p_hash text | jsonb   (NEW)
--   app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1;

-- 19: the app may update 19 delivery columns (16 before, plus the three new ones)
select count(*) from information_schema.column_privileges
where table_schema = 'public' and table_name = 'design_engagements'
  and grantee = 'metra_app' and privilege_type = 'UPDATE';

-- 0: anon and authenticated hold nothing on any public table or sequence (step 2 (f) again)
select count(*) as api_role_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join lateral aclexplode(c.relacl) a
join pg_roles r on r.oid = a.grantee
where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  and r.rolname in ('anon', 'authenticated');

-- 0: tables and sequences created from now on are not granted to them either
select count(*) as api_role_defaults
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
cross join lateral aclexplode(d.defaclacl) a
join pg_roles r on r.oid = a.grantee
where d.defaclrole = 'postgres'::regrole
  and d.defaclobjtype in ('r', 'S')
  and r.rolname in ('anon', 'authenticated');

-- 0: nothing was backfilled
select (select count(*) from organizations
         where studio_phone is not null or studio_whatsapp is not null
            or instapay_address is not null or bank_name is not null
            or bank_account_number is not null or bank_iban is not null)
     + (select count(*) from design_engagements
         where client_expected_on is not null or client_expected_set_at is not null)
       as touched;
```

**5. Afterwards: merge, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-c-c7`. Merging deploys automatically: wait for the Deploy
   workflow to go green.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**What you will notice between step 3 and the C7 deploy.** One thing: on an
ended delivery with a milestone still unpaid, the client page no longer offers
"I've made this payment" (it used to, and the claim was then refused). Nothing
else: no deployed code reads the new snapshot fields, calls the new functions
or names the new columns, the one changed function the live portal calls
(`app_delivery_act_notified_by_token`) gives the same answers, and the
deployed Settings page writes none of the seven studio columns the new
trigger guards.

**What changes at the C7 deploy.** Still nothing you can see: C7 carries the
schema, the functions and their tests, and no screen. The Settings card for
the studio's phone and payment details, the client page timeline, contact
buttons, logo and gallery, the inline handover close and the hourly repair of
lost notifications arrive with the Wave 3 PRs, which are cut after this merge.
When the hourly repair arrives, it tells STUDIO members (the roles the
permission matrix gives each act) about a client act whose notification was
lost; it never messages a client, and it repairs each act once.

**From now on, only an owner or admin changes the studio's phone, WhatsApp or
payment details,** through Settings (Wave 3). Editing those seven columns from
the SQL editor is refused with MT120, because the editor carries no app
session; that is the rule working, not a fault.

**Undo, if ever needed.** Undo the CODE, never the database: roll the Worker
back with `npx wrangler rollback <version-id>` from `apps\web` (see *Rolling back*). Every Worker
version runs on the 0058 database: older code never names the new columns and
never calls the new functions. Do NOT run `db:apply-rls` from an older `main`
while C7-or-later code serves: it restores the older `app_delivery_by_token`
(the client page then loses its timeline, contact and payment details) and
narrows the delivery UPDATE grant back to 16 columns, so saving an expected
date (Wave 3) fails with 42501. `apply-rls` never drops a function or a
trigger, so the new ones stay, and an older `roles.sql` never re-grants
anything to `anon` or `authenticated`. The columns, the CHECKs and the index
stay: dropping a column is the one non-additive change this file never makes.
