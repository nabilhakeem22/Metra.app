# 0059 and the Round D database step: owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Round D has ONE database step, and this is it (Wave 1 had none): migration
`0059_client_page_checks_tightened.sql` plus changed and new functions, one
new trigger and grants under `rls/`. It is validated on branch `validate/round-d-db`. The Wave 3
PR (the client page's consent guard, receipts and the one-tap approve and
budget split) is cut only after this step is done and the branch is merged.

**THE ORDER (do not change it):**

1. **You run the database step on production FIRST**, from the
   `validate/round-d-db` branch (steps 1 to 4 below).
2. **Then** the lead merges `validate/round-d-db` (step 5).
3. **Only then** is the Wave 3 PR cut and merged.

Why, one sentence each:

- **The database step before the code is safe:** it adds no column, the live
  code never calls the new seven-argument respond function, it ignores the new
  fields of the client page snapshot, every function it calls keeps its exact
  arguments and result, and every value the live Settings card saves passes the
  tightened CHECKs (a test saves thousands of generated values through the
  real Settings code against the new CHECKs, with no refusal), and the new
  band trigger changes nothing the live code does (its one band writer
  already clears the issuance stamp). Measured on a fresh database built from
  this branch: main's own 970 database
  tests ran and 966 passed; the four that failed are lists that pin "one
  overload per function" or 0058's loosest phone, which this branch updates,
  not behaviour of the live code.
- **Wave 3 before the database step is an outage:** every review act on the
  client page (approve, ask for changes, confirm the budget) fails with 42883
  (no such function), and the payments card shows no receipts.

**What the live code sees differently between step 3 and Wave 3.** Two small
things, both fixes:

- A client's repeat tap that repairs a lost studio notification no longer
  turns it into "2 times" when the hourly repair already sent it: one act is
  one count, whoever reports it first.
- The client's expected date is compared with stage moves to the
  millisecond, as the studio's card already does, so the two can no longer
  disagree about a move recorded inside the same millisecond.

**What it changes.** No column, no row, no backfill.

| Object | Change |
|---|---|
| `organizations_studio_phone_format` | tightened: `+` and 8 to 15 digits with a country code that does not start with 0, or an Egyptian number with its trunk 0 (`0` then 8 to 10 digits). Was: 7 to 15 digits with an optional `+` |
| `organizations_studio_whatsapp_format` | tightened: the same international form, or an Egyptian mobile `01` + `0`, `1`, `2` or `5` + 8 digits (a landline cannot open WhatsApp) |
| `organizations_payment_text_printable` | tightened: InstaPay, bank name and account holder may also hold no C0 or C1 control character, and may not be made ONLY of these: white space, NEL, the Braille blank, the Hangul fillers, the combining marks of the listed scripts (Latin, Cyrillic, Arabic and the generic combining blocks), the Khmer inherent vowels, the Mongolian and the other variation selectors, the Egyptian hieroglyph mirror, the Khitan filler, private-use characters and noncharacters. A list, not all of Unicode: a lone mark of another script still passes here (the Settings card refuses it) |
| `app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)` | NEW overload, returns `text`: the client's review act names the issuance it saw (the budget band's, or the render round's); a band re-issued or renders re-stamped since the page loaded answers `wrong_state` and saves nothing. The design and budget checks are independent |
| `app_delivery_respond_by_token(text, text, text, text, text, text)` | unchanged; retired from app use by Wave 3 and dropped at the next database step |
| `app_delivery_by_token(text)` | same signature and result (`jsonb`); new fields `rom.issued_at`, `renders_issued_at`, `receipts` (the newest 200 payments of the delivery: kind, amount, date; no method, reference or note) and `receipts_truncated` (true only past 200 payments); the expected date is compared with stage moves to the millisecond |
| `app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)` | same signature and result; a member who already has a notification for this client act (read or not) is not counted twice. Comments are exempt: each comment is a new act |
| `app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)` | same signature and result; it now repairs a lost budget acknowledgement before the design decisions, the order the client page uses, so the two can never wait on each other |
| `trg_design_engagements_rom_issue` + `clear_rom_issue_on_band_change()` | NEW trigger on `design_engagements`, before an update of `rom_low` or `rom_high`: a band change that keeps the old issuance stamp clears it, so a changed band always has to be issued again before the client can confirm it. It never refuses an update; issuing new numbers with a new stamp in one statement is left alone |
| grants | the new overload and the new trigger function: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated` and `service_role` in the same transaction that creates them (and again in `roles.sql`) |

**Not in this step** (each comes later, in this order):

- U+2028 and U+2029 (line and paragraph separators) in the studio's payment
  text: the Settings card refuses them first (Wave 3), then a CHECK at the
  next database step.
- Phone numbers starting `+200`: see the deviation below.
- The six-argument respond function: EXECUTE is revoked from `metra_app` once
  Wave 3 is past its rollback window, and it is dropped at the next database
  step.

**Deviation from the Round D plan (D2-D1): `+200` numbers still pass.** The
plan's phone and WhatsApp CHECKs refused `+200...` (a +20 number that keeps
its trunk 0). The live Settings card can store such a number: it drops ONE
zero after +20, so "+20 00 10 1234 5678" is saved as `+2001012345678`. A
CHECK that refused it would make that save fail with 23514, and the rule for
this step is that the database is never stricter than the app. So 0059 lets
`+200` through. The app is fixed first (Wave 3 drops the extra zeros); the
CHECK refuses `+200` at a later database step, after counting the stored
`+200` numbers.

**1. Put the Round D database code in the production checkout.** Detach onto
the branch (it is checked out in another worktree). This step changes no
dependency (`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-d-db
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat aa84dbd HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (aa84dbd)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). Note the numbers:

```sql
-- 0059 step 2: read-only, before.
-- (a) migrations recorded so far: expect 59, and newest 1791583616467 (0058)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (c) 11 rows today, ONE of them app_delivery_respond_by_token. Keep this output: step 4 runs it again.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;

-- (d) 1 row, NULL: the new overload does not exist yet
select to_regprocedure('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)') as overload;

-- (e) how many studios have a phone, WhatsApp or payment text set. Note the number; step 4 expects the same.
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;

-- (f) 0 rows: the new trigger and its function do not exist yet
select tgname as name from pg_trigger where tgname = 'trg_design_engagements_rom_issue'
union all
select proname from pg_proc where proname = 'clear_rom_issue_on_band_change';
```

**(b) THE PRE-CHECK. 0 rows, or STOP.** It lists every studio whose saved
phone, WhatsApp or payment text the tightened CHECKs would refuse, and which
rule (`false` in that column). If it returns ANY row, do not run step 3: the
migration would fail with 23514 and change nothing. Instead, for each studio
listed, the owner or an admin of that studio opens Settings and fixes the field
whose column reads `false` (the Settings card stores the clean form, or says
what is wrong with it). The sheet sends only the boxes that differ from what it
opened with, so retyping the same text in place sends nothing: for a phone or
WhatsApp number, clear it and save, then type it again and save; for a payment
text, delete it and type it again by hand (a value typed by hand carries none
of the hidden characters that made it fail, so it differs and is sent). Then
run this query again until it returns 0 rows. Never fix it in the SQL editor: it is refused there with MT120,
by design, and tell the lead which studios were listed.

```sql
-- 0059 step 2 (b): the studios a tightened CHECK would refuse. Expect 0 rows.
select id, name_en, name_ar, phone_ok, whatsapp_ok, payment_text_ok
from (
  select id, name_en, name_ar,
         coalesce(studio_phone IS NULL OR studio_phone ~ '^\+[1-9][0-9]{7,14}$' OR studio_phone ~ '^0[1-9][0-9]{7,9}$', true) as phone_ok,
         coalesce(studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' OR studio_whatsapp ~ '^01[0125][0-9]{8}$', true) as whatsapp_ok,
         coalesce((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')), true) as payment_text_ok
  from public.organizations
) checked
where not (phone_ok and whatsapp_ok and payment_text_ok);
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so re-run query (a) from step 2: `migrations` is exactly one higher
  (60) and `newest` is `1791734529315` (0059's journal stamp).
- `db:apply-rls` ends with these two lines (one trigger and one function
  more than after 0058: the band trigger and its function; the new respond
  overload shares its function's name, and the counts are by name. A fresh
  CI-shaped database printed exactly these on this branch, and a
  production-shaped rehearsal printed them verbatim, twice):
  `apply-rls: verified in the catalogues — 46 tables, 46 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`
  and
  `apply-rls: grants verified — design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0, and its functions line reads
  `assert-schema-applied: functions — 44 declared, all present.` (its index and constraint lines are report only and
  do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations` for more than 3 s. Re-run `db:migrate` a
  little later. The same two codes from `db:apply-rls` print `apply-rls
  failed: ...` and end `(this file rolled back; the files before it stay
  applied).`: re-run `db:apply-rls`. (Rehearsed: a reader holding
  `organizations` gave exactly the 55P03 lines, and the migration count did not
  move.)
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  A studio's saved value breaks a tightened CHECK; every 0058 CHECK is still in
  place. Do not re-run yet: run step 2 (b), fix each studio it lists as it
  says, tell the lead, and only then re-run `db:migrate`. (Rehearsed: one
  planted bad account holder gave exactly these lines, step 2 (b) listed that
  studio, and after it was re-typed the migration ran.)
- Any other code ends `tell the lead before running anything else`.

**Locks.** `db:migrate` runs 0059 as ONE transaction: ACCESS EXCLUSIVE on
`organizations` from the first of its three CHECK swaps until the commit, with
one scan of the table for each new CHECK. Almost every studio page and every
client page reads `organizations`, so pages opened in that window wait; none
fails. At pilot size this is well under the migrator's 3 s `lock_timeout`;
that is an estimate, not a production measurement. `db:apply-rls` replaces
functions without table locks; the policy files are the 33 s worst case
described above.

**4. Read-only, after: expected results.** Run step 2 (b) again first: 0 rows.
Then:

```sql
-- 0059 step 4: read-only, after.
-- 60 and 1791734529315 (0059)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- 3 rows, tightened = true on every one:
--   organizations_payment_text_printable | t
--   organizations_studio_phone_format    | t
--   organizations_studio_whatsapp_format | t
select conname,
       case conname
         when 'organizations_studio_phone_format'
           then pg_get_constraintdef(oid) like '%[1-9][0-9]{7,14}%' and pg_get_constraintdef(oid) like '%0[1-9][0-9]{7,9}%'
         when 'organizations_studio_whatsapp_format'
           then pg_get_constraintdef(oid) like '%01[0125][0-9]{8}%'
         else pg_get_constraintdef(oid) like '%u2800%'
       end as tightened
from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_payment_text_printable')
order by conname;

-- Step 2 (c) again. 12 rows: every row from before is IDENTICAL, and there is
-- exactly one new one, the second app_delivery_respond_by_token (marked NEW):
--   app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
--   app_delivery_by_token                   | p_hash text | jsonb
--   app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_close_target_by_token      | p_hash text | jsonb
--   app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
--   app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
--   app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
--   app_delivery_logo_by_token              | p_hash text | jsonb
--   app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text | text   (NEW)
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;

-- 2 rows: metra_app = true, public_grants = 0, anon = authenticated = service_role = false on both
select f.sig, has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values ('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'),
             ('public.clear_rom_issue_on_band_change()')) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- 1 row: O | CREATE TRIGGER trg_design_engagements_rom_issue BEFORE UPDATE OF rom_low, rom_high ON public.design_engagements FOR EACH ROW EXECUTE FUNCTION clear_rom_issue_on_band_change()
select tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid = 'public.design_engagements'::regclass and tgname = 'trg_design_engagements_rom_issue';

-- The same number as step 2 (e): nothing was touched
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;
```

**5. Afterwards: merge, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-d-db`. Merging deploys automatically: wait for the Deploy
   workflow to go green. The merge carries no screen change (the schema
   description, the database tests and this runbook); the Wave 3 PR is cut
   after it.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.** Undo the CODE, never the database: roll the Worker
back with `npx wrangler rollback <version-id>` from `apps\web` (see *Rolling back*). Every Worker
version runs on the 0059 database, because the six-argument respond function
stays (until 0060, which drops it). Do NOT run `db:apply-rls` from a `main` older than this branch once
Wave 3 serves: it restores the older `app_delivery_by_token` without the
issuance instants and receipts, so every design approval and budget
confirmation on the client page answers "this changed, please look again" and
the receipts disappear. `apply-rls` never drops a function or a trigger, so
the new overload and the band trigger stay either way; every older Worker
works with the trigger, because the app's band writer already clears the
stamp itself.

**Only if a legitimate studio value is refused** by a tightened CHECK (the
Settings card then says "something went wrong" on save; the lead confirms it
from the Worker logs as 23514), put the three 0058 CHECKs back with this ONE
statement (atomic on its own; it touches no row, and every value saved under
0059 also passes 0058), then tell the lead:

```sql
-- 0059 undo: the three 0058 CHECKs back, as ONE statement.
alter table public.organizations
  drop constraint if exists organizations_studio_phone_format,
  drop constraint if exists organizations_studio_whatsapp_format,
  drop constraint if exists organizations_payment_text_printable,
  add constraint organizations_studio_phone_format
    check (studio_phone IS NULL OR studio_phone ~ '^\+?[0-9]{7,15}$'),
  add constraint organizations_studio_whatsapp_format
    check (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+?[0-9]{7,15}$'),
  add constraint organizations_payment_text_printable
    check ((instapay_address IS NULL OR (instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_name IS NULL OR (bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_account_holder IS NULL OR (bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')));
```
