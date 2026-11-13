# 0060 and the Round E database step: owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Round E has ONE database step, and this is it (Wave 1 had none): migration
`0060_client_page_checks_round_e.sql` plus changed functions and grants under
`rls/`, and ONE function DROPPED. It is validated on branch
`validate/round-e-db`.

**THE ORDER (do not change it):**

0. **The app goes first.** Round E Wave 1 and `validate/round-e-db` are merged
   to `main` and deployed (the Deploy workflow green). This is safe: the
   branch's app-side changes are tests and comments only, and no Worker code
   in it needs 0060. You then confirm, in step 2 (f), that the live Worker is
   that deploy, which is above the rollback floor.
1. **Then you run the database step on production**, from the
   `validate/round-e-db` branch (steps 1 to 4 below). The lead keeps that
   branch until step 5 is done.
2. **Then** you smoke-test and tell the lead (step 5).

**FROM STEP 3 ON, NO WORKER VERSION OLDER THAN THE ROUND D WAVE 3 DEPLOY MAY
EVER SERVE AGAIN.** Such a version calls the six-argument respond function
this step drops, so every review act on the client page (approve, ask for
changes, confirm the budget) would fail with 42883 (no such function). Step 2
(f) writes down the versions `wrangler rollback` may still pick.

Why this order is safe, one sentence each:

- **The app before the database is safe:** the merged code changes no Worker
  behaviour; it carries this step's database files, its tests and comments.
- **The dropped function has no caller:** every Worker version since Round D
  Wave 3 calls only the seven-argument respond function
  (`respond-arity.test.ts` refuses any other form in the app's source).
- **The CHECKs are looser than the live app:** since Wave 3 the Settings card
  drops every trunk 0 after +20 and refuses a line or paragraph separator
  anywhere, and it already treated U+1D159 as blank; a test saves thousands of
  generated values through the real Settings code against the new CHECKs,
  with no refusal. A read-only count on Oct 12 2026 found no stored `+200`
  number and no payment text holding U+2028, U+2029 or U+1D159.
- **The four timed functions keep their signatures,** so their grants are kept
  and every caller is unchanged.
- **Measured** on a fresh database built from this branch: main `43f06c4`'s
  own 1041 database tests (with its own `packages/db`) ran and 1024 passed.
  The 17 that failed are pins this branch updates (the dropped function's
  rows and calls, the new `lock_timeout` setting, and `+200` numbers that 0059
  still kept), not behaviour of the live code. One of them,
  `delivery-db-step-0058-api-roles`, replays `43f06c4`'s `roles.sql` on its own,
  which names the dropped function and so fails on 0060.

**What it changes.** No column, no row, no backfill.

| Object | Change |
|---|---|
| `organizations_studio_phone_format` | an international number may no longer start `+200` (Egypt's code with its trunk 0 kept). Everything else as 0059 |
| `organizations_studio_whatsapp_format` | the same `+200` rule. Everything else as 0059 |
| `organizations_payment_text_printable` | InstaPay, bank name and account holder may no longer hold U+2028 or U+2029 (line and paragraph separators) anywhere, and a value made ONLY of U+1D159 (the musical null notehead) and the other invisible characters 0059 lists is refused. "CIB" followed by U+1D159 is kept, as the app keeps it. The same whole-value rule covers the unassigned default-ignorable code points (U+FFF0 to U+FFF8, U+E0000, U+E0002 to U+E001F, U+E0080 to U+E00FF, U+E01F0 to U+E0FFF), which the app already refuses as a whole value |
| `app_delivery_respond_by_token(text, text, text, text, text, text)` | DROPPED. Retired from app use since Round D Wave 3 |
| `app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)` | same signature, result and grants; waits at most 4 s for the delivery row (`lock_timeout`), then fails with 55P03 and saves nothing |
| `app_delivery_claim_payment_by_token(text, text, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `app_delivery_comment_by_token(text, uuid, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `rls/roles.sql` | the dropped function's grant, revoke and API-role revoke lines removed |
| `app_current_user_orgs()`, `app_claim_invitation(uuid)` | same signatures, results and grants; every `db:apply-rls` drops and re-creates them (a return type change), and they are now locked down in the same transaction, not only files later in `roles.sql` |
| `policies/40-engagements.sql` | same policies and trigger; `design_engagements` is now the LAST table the file touches |

Why 4 s: the client page's one-tap "approve the design and confirm the budget"
is two of these calls, and 2 x 4 s stays under the app's 15 s database
deadline. So a tap that waits on a long studio transaction is refused and
rolled back BEFORE the app gives up on it: the client reads "try again" and
nothing was saved, never "try again" about a write that later commits.

**1. Put the Round E database code in the production checkout.** Detach onto
the branch (it is checked out in another worktree). This step changes no
dependency (`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-e-db
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat dc6e381 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (dc6e381)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN: paste it,
run it, note the result, then the next one.

(a) How many migrations are recorded. Expect `migrations` 60 and `newest`
1791734529315 (0059's journal stamp).

```sql
-- 0060 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. 0 rows, or STOP.** It lists every studio whose saved
phone, WhatsApp or payment text a new CHECK would refuse, and which rule
(`false` in that column). If it returns ANY row, do not run step 3: the
migration would fail with 23514 and change nothing. Instead, for each studio
listed, the owner or an admin of that studio opens Settings and fixes the field
whose column reads `false` (the Settings card stores the clean form, or says
what is wrong with it). The sheet sends only the boxes that differ from what it
opened with, so retyping the same text in place sends nothing: for a phone or
WhatsApp number, clear it and save, then type it again and save; for a payment
text, delete it and type it again by hand (a value typed by hand carries none
of the hidden characters that made it fail, so it differs and is sent). Then
run this query again until it returns 0 rows. Never fix it in the SQL editor:
it is refused there with MT120, by design. Tell the lead which studios were
listed.

```sql
-- 0060 step 2 (b): the studios a new CHECK would refuse. Expect 0 rows.
select id, name_en, name_ar, phone_ok, whatsapp_ok, payment_text_ok
from (
  select id, name_en, name_ar,
         coalesce(studio_phone IS NULL OR (studio_phone ~ '^\+[1-9][0-9]{7,14}$' AND studio_phone !~ '^\+200') OR studio_phone ~ '^0[1-9][0-9]{7,9}$', true) as phone_ok,
         coalesce(studio_whatsapp IS NULL OR (studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' AND studio_whatsapp !~ '^\+200') OR studio_whatsapp ~ '^01[0125][0-9]{8}$', true) as whatsapp_ok,
         coalesce((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')), true) as payment_text_ok
  from public.organizations
) checked
where not (phone_ok and whatsapp_ok and payment_text_ok);
```

(c) The client page functions. 12 rows today, TWO of them
`app_delivery_respond_by_token` (the six-argument one is the row this step
drops). Keep this output: step 4 (c) runs it again.

```sql
-- 0060 step 2 (c): the client page functions. Run this one alone.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;
```

Expected (`proname | args | result`):

```text
app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
app_delivery_by_token                   | p_hash text | jsonb
app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_close_target_by_token      | p_hash text | jsonb
app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
app_delivery_logo_by_token              | p_hash text | jsonb
app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
app_delivery_respond_by_token           | p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text   (DROPPED in step 3)
```

(d) The four writes step 3 gives a `lock_timeout`. 4 rows, in this order
(`choose_concept`, `claim_payment`, `comment`, `respond`), and `config` holds
ONE setting on each: `search_path=""`.

```sql
-- 0060 step 2 (d): the settings of the four timed writes. Run this one alone.
select f.sig, p.proconfig as config
from (values ('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'),
             ('public.app_delivery_claim_payment_by_token(text, text, text, text, text, text)'),
             ('public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)'),
             ('public.app_delivery_comment_by_token(text, uuid, text, text, text, text)')) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure
order by 1;
```

(e) How many studios have a phone, WhatsApp or payment text set. Note the
number; step 4 expects the same.

```sql
-- 0060 step 2 (e): studios with client page details. Run this one alone.
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;
```

(f) **THE ROLLBACK FLOOR.** In PowerShell, list the Worker's deployments:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler deployments list
cd C:\Users\HP\merta-main
```

The dates in the list are UTC (Cairo is UTC+3). Each version id is printed
after `(100%)` under `Version(s):`.

**THE FLOOR is version `85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627`**, the Round D
Wave 3 deploy of main `43f06c4`, created `2026-10-12T00:35` UTC. It and every
version created after it may serve; nothing older may, ever again, once step 3
runs. The Round E app deploy (THE ORDER, 0) is later still and is the newest
line: write down its version id too. **From step 3 on, `npx wrangler rollback
<version-id>` may only ever be given one of these ids, and never run without
one** (see *Rolling back*). If the newest deploy is not the Round E app deploy,
STOP: the app goes first.

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** `db:apply-rls` also prints routine NOTICE
blocks (several lines each, with `severity: 'NOTICE'` and a `message:` line).
They are not failures. The production-shaped rehearsal printed these
`message:` lines (on Supabase a line about a role may differ; any line that
ends `does not exist, skipping` or `already exists, skipping` is the same
kind):

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`:
  `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`.
  If you ever run `db:apply-rls` a second time, it adds one more first:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  (the drop has nothing left to drop).

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (61).
- `db:apply-rls` exits 0 and ends with the same two lines as after 0059 (the
  dropped function shares its name with the one that stays, and the counts
  are by name). The first starts `apply-rls: verified in the catalogues` and
  goes on `46 tables, 46 policies, 15 triggers, 44 functions, RLS forced on
  all of them, role metra_app present.`; the second starts
  `apply-rls: grants verified` and goes on `design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
  A production-shaped rehearsal (main `43f06c4`'s own migrate and apply-rls
  on a database with the Supabase API roles and their default EXECUTE, then
  this branch) printed exactly these, twice.
- `assert-schema-applied` exits 0, and its functions line starts
  `assert-schema-applied: functions` and ends `44 declared, all present.` (its
  index and constraint lines are report only and do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations` for more than 3 s. Re-run `db:migrate` a
  little later. The same two codes from `db:apply-rls` print `apply-rls
  failed: ...` and end `(this file rolled back; the files before it stay
  applied).`: re-run `db:apply-rls`. (Rehearsed: a reader holding `organizations` gave
  exactly the 55P03 lines, and the migration count stayed 60.)
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  A studio's saved value breaks a new CHECK; every 0059 CHECK is still in
  place. Do not re-run yet: run step 2 (b), fix each studio it lists as it
  says, tell the lead, and only then re-run `db:migrate`. (Rehearsed: one planted
  `+2001012345678` gave exactly these lines, naming
  `organizations_studio_phone_format`; step 2 (b) listed that studio with
  `phone_ok` false; after the number was saved again the migration ran.)
- Any other code ends `tell the lead before running anything else`.

**55P03 on the client page WHILE step 3 runs is the step itself.** From the
moment `db:apply-rls` gives the four client writes their 4 s `lock_timeout`, a
client tap that queues behind one of the step's own locks for more than 4 s is
refused with 55P03 and saves nothing (the client reads "try again"). That is
not a reason to undo anything: a retry after the step has finished succeeds.
Undo (2) is only for 55P03 lines that keep coming AFTER step 3 is done.

**Locks.** `db:migrate` runs 0060 as ONE transaction: ACCESS EXCLUSIVE on
`organizations` from the first of its three CHECK swaps until the commit, with
one scan of the table for each new CHECK. Almost every studio page and every
client page reads `organizations`, so pages opened in that window wait; none
fails. At pilot size this is well under the migrator's 3 s `lock_timeout`;
that is an estimate, not a production measurement. `db:apply-rls` replaces
and drops functions without table locks; the policy files are the 33 s worst
case described above. `policies/40-engagements.sql` now touches
`design_engagements` LAST, so that table is never held while the file waits
on another one (measured with a 2.5 s reader on another engagement table: held
about 2,440 ms before this change, 3 to 16 ms after).

**4. Read-only, after: expected results.** Again each block ON ITS OWN. First
run step 2 (b) again: 0 rows.

(a) `migrations` 61 and `newest` 1791767848859 (0060's journal stamp).

```sql
-- 0060 step 4 (a): migrations recorded now. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) 3 rows, `tightened` true on every one:
`organizations_payment_text_printable`, `organizations_studio_phone_format`,
`organizations_studio_whatsapp_format`. (Before step 3, and after undo (3),
all three read false.)

```sql
-- 0060 step 4 (b): the three new CHECKs. Run this one alone.
select conname,
       case conname
         when 'organizations_payment_text_printable'
           then strpos(pg_get_constraintdef(oid), '\u009F\u2028\u2029]') > 0
            and strpos(pg_get_constraintdef(oid), '\uFFA0\U0001D159') > 0
         else strpos(pg_get_constraintdef(oid), '!~ ''^\+200''') > 0
       end as tightened
from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_payment_text_printable')
order by conname;
```

(c) Step 2 (c) again, as its own block. 11 rows: every row from before is
IDENTICAL except that the LAST one (the six-argument
`app_delivery_respond_by_token`) is gone. Exactly one
`app_delivery_respond_by_token` row is left, the one with
`p_expected_issue_at`.

(d) NULL: the six-argument respond function is gone.

```sql
-- 0060 step 4 (d): the dropped function. Run this one alone.
select to_regprocedure('public.app_delivery_respond_by_token(text, text, text, text, text, text)') as dropped;
```

(e) Step 2 (d) again, as its own block. The same 4 rows, and `config` now
holds TWO settings on each: `search_path=""` and `lock_timeout=4s`.

(f) 1 row: `metra_app` true, `public_grants` 0, `anon`, `authenticated` and
`service_role` false.

```sql
-- 0060 step 4 (f): who may run the respond write. Run this one alone.
select has_function_privilege('metra_app', p.oid, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p
where p.oid = 'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'::regprocedure;
```

(g) Step 2 (e) again: the same number. Nothing was touched.

**5. Afterwards: smoke test, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Smoke test on one of the studio's own TEST deliveries, never a client's,
   with the log open (from `C:\Users\HP\merta-main\apps\web`:
   `npx wrangler tail metra-web`):
   - approve the design with the budget, as steps 1 to 3 of the [*Round D
     Wave 3*](0059b-round-d-wave-3-smoke.md) smoke test;
   - write one comment on a shared document from the client link.

   Expected: both are saved, and the log shows no `42883` and no `55P03`. An
   "exceeded CPU" page (error 1102) is a retry, not a failure (see [*Round D
   Wave 3*](0059b-round-d-wave-3-smoke.md)).
3. Tell the lead the step is done. The branch is already merged and deployed
   (THE ORDER, 0); nothing is merged now.
4. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.** There is no undo that brings the six-argument
function back: no Worker allowed to serve calls it. Never run `db:apply-rls`
from a tree older than this branch.

**(1) The code.** From `C:\Users\HP\merta-main\apps\web`, run
`npx wrangler rollback <version-id>` with an id you wrote down in step 2 (f):
the floor `85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627` or a later one. **Never run it
without an id:** it then picks the deployment before the current one, which
may be below the floor. **A version older than the floor answers 42883 on
every review act on the 0060 database.**

**(2) Only the `lock_timeout`s** (the log shows client taps failing with
`55P03` because a studio transaction is legitimately long, AFTER step 3 is
done; for 55P03 while step 3 runs, see step 3). Run this ONE
block; each function keeps its grants. A later `db:apply-rls` from this
branch or a newer `main` puts the four back. Rehearsed: step 2 (d) then
shows `search_path=""` alone on all four.

```sql
-- 0060 undo (2): the four lock_timeouts off.
alter function public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_claim_payment_by_token(text, text, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_comment_by_token(text, uuid, text, text, text, text) reset lock_timeout;
```

**(3) The CHECKs,** only if a legitimate studio value is refused by a new
CHECK (the Settings card then says "something went wrong" on save; the lead
confirms it from the Worker logs as 23514). This ONE statement puts the three
0059 CHECKs back (atomic on its own; it touches no row, and every value saved
under 0060 also passes 0059). Then tell the lead. Rehearsed: step 4 (b)
then reads false on all three, and the 0060 file run again brings them back.

```sql
-- 0060 undo (3): the three 0059 CHECKs back, as ONE statement.
alter table public.organizations
  drop constraint if exists organizations_studio_phone_format,
  drop constraint if exists organizations_studio_whatsapp_format,
  drop constraint if exists organizations_payment_text_printable,
  add constraint organizations_studio_phone_format
    check (studio_phone IS NULL OR studio_phone ~ '^\+[1-9][0-9]{7,14}$' OR studio_phone ~ '^0[1-9][0-9]{7,9}$'),
  add constraint organizations_studio_whatsapp_format
    check (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' OR studio_whatsapp ~ '^01[0125][0-9]{8}$'),
  add constraint organizations_payment_text_printable
    check ((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')));
```
