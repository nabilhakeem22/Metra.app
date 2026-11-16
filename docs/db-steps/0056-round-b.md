# 0056 and the Round B database step (PR-B9): owner runbook

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

PR-B9 is a database batch: migration `0056_round_b_client_signals.sql` plus
changed and new functions and one trigger under `rls/`.

**THE ORDER (do not change it):**

1. **You run PR-B9's database step on production FIRST** (steps 1 to 5 below):
   `db:migrate`, then `db:apply-rls`, then the checks.
2. **Only then** does `validate/round-b-combined` merge. It is PR-B9
   (`validate/round-b-db`) and Wave 1 (`validate/round-b-w1`, which contains
   B3) merged into one branch and validated together by CI.
3. PR-B10 to PR-B12 merge after that.

Why, one sentence each:

- **Wave 1 before the database step strands deliveries:** B3's studio card
  treats a client design decision from an EARLIER render round as not
  answering the current one, while the portal's pre-B9 SQL still counts it,
  so the card says "Waiting for the client" and the client has no button
  (only "Client approved offline" gets the delivery out).
- **PR-B9's code before the migration is an outage:** its drizzle schema names
  the two new columns and Drizzle full-row selects list every column, so every
  engagement read fails with 42703 (*Deploying before migrating* above).
- **The database step before any of that code is safe:** the live code never
  names the new columns, and every function it calls keeps its exact argument
  list and return type (pinned by `delivery-portal-round-b.dbtest.ts`); the live
  portal only gains the behaviours listed under *What you will notice*.

**What it changes.** Additive only; no row is updated or backfilled.

| Object | Change |
|---|---|
| `design_engagements.token_nonce` | new nullable `text` column |
| `design_engagements_token_nonce_needs_hash` | CHECK `token_nonce IS NULL OR token_hash IS NOT NULL` |
| `engagement_events.chosen_artifact_id` | new nullable `uuid` column |
| `engagement_events_chosenArtifact_same_org_fk` | FK `(org_id, chosen_artifact_id)` to `engagement_artifacts (org_id, id)`, ON DELETE NO ACTION |
| `engagement_events_chosen_artifact_only_concept` | CHECK `chosen_artifact_id IS NULL OR kind::text = 'concept_approval'` |
| `engagement_events_chosenArtifact_idx` | index on `(org_id, chosen_artifact_id)` |
| `trg_design_engagements_token_nonce` + `clear_token_nonce_on_hash_change()` | NEW BEFORE UPDATE trigger: an update that changes `token_hash` without setting `token_nonce` clears the old nonce, so older code (and a rolled-back Worker) can rotate or revoke without tripping the CHECK |
| `app_delivery_respond_by_token` | same signature; a design decision answers one render issuance (`renders_ready_at`); decisions the studio retracted are ignored; decision verbs take the row lock; an `ok` refreshes `updated_at` |
| `app_delivery_claim_payment_by_token`, `app_delivery_comment_by_token` | same signatures; an `ok` refreshes `updated_at` |
| `app_delivery_by_token` | same signature; per-round design verbs, retracted decisions ignored; new keys `concept_options` (stable positions 1 to 4), `concept_choice_id`, `concept_choice_position` |
| `app_delivery_choose_concept_by_token(text, uuid, text, text, text, text)` | NEW, returns `text` |
| `app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)` | NEW, returns `jsonb`; accepts only the nine client-act message keys and params up to 2048 bytes |
| grants | both new functions: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated`, `service_role` in the same transaction that creates them (and again in `roles.sql`); `token_nonce` added to the column-level UPDATE grant on `design_engagements` (16 columns) |

**1. Put the PR-B9 code in the production checkout.** The branch is checked
out in another worktree, so detach onto it rather than switching to it. This
PR changes no dependency, so the installed `node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-b-combined
git log --oneline -1    # must be the SHA the lead gave you for this run, with green CI
```

**2. Read-only, before** (Supabase SQL editor). Note the three numbers:

```sql
-- (a) migrations recorded so far, and the newest one's stamp
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (b) how big the tables the migration locks are
select (select count(*) from design_engagements)   as deliveries,
       (select count(*) from engagement_events)    as ledger_rows,
       (select count(*) from engagement_artifacts) as artifacts;

-- (c) deliveries at final_approval whose client decided on an EARLIER render
-- issuance (the studio revised after the decision). After step 3 the portal
-- offers "approve design" to these clients again. Expected: small, often 0.
select count(*) from design_engagements de
where de.state = 'final_approval'
  and de.renders_ready_at is not null
  and exists (
    select 1 from engagement_events e
    where e.engagement_id = de.id and e.actor_channel = 'client'
      and e.kind in ('design_approval', 'design_change_request'))
  and not exists (
    select 1 from engagement_events e
    where e.engagement_id = de.id and e.actor_channel = 'client'
      and e.kind in ('design_approval', 'design_change_request')
      and (e.acknowledged_issue_at is not distinct from de.renders_ready_at
           or (e.acknowledged_issue_at is null
               and e.decided_at >= de.renders_ready_at)));
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected:

- `db:migrate` exits 0. It does not print a count, so re-run query (a) from
  step 2: `migrations` is exactly one higher and `newest` is `1791323400835`
  (0056's journal stamp).
- `db:apply-rls` ends with `apply-rls: verified in the catalogues — 46 tables,
  46 policies, 13 triggers, 35 functions, ...` and `design_engagements update
  narrowed to 16 columns`.
- `assert-schema-applied` exits 0.

If `db:apply-rls` is run BEFORE `db:migrate`, it stops at
`40-delivery-read.sql` with 42703 (that function's SQL body is checked against
the columns when it is created). Nothing is broken: run `db:migrate` and then
`db:apply-rls` again. Every statement in both is re-runnable, and a 55P03 from
either is a lock wait that gave up: re-run at a quieter moment.

**Locks.** `db:migrate` runs 0056 as ONE transaction:

- It holds ACCESS EXCLUSIVE on `design_engagements` and `engagement_events`
  from the first ADD COLUMN until it commits, so reads AND writes of both
  tables wait for the whole batch, not only for the scans.
- Inside that window: one scan of each table for the CHECKs, an FK validation
  over an all-NULL column, and one index build.
- The FK also takes SHARE ROW EXCLUSIVE on `engagement_artifacts`: uploads and
  artifact edits wait, artifact reads continue.
- With the row counts from step 2 (b) in the low thousands this is well under a
  second, comparable to 0049 and 0050's measured ~630 ms, against the
  migrator's 3 s `lock_timeout`. It is an estimate, not a production
  measurement. Delivery pages opened in that window wait; they do not fail.

`db:apply-rls` is the same run as always: the functions replace without table
locks; the new trigger's `drop trigger` and `create trigger` briefly lock
`design_engagements`; the policy files are the 33 s worst case described above.

**4. Read-only, after: expected results.**

```sql
-- 2 rows, both is_nullable = YES
select table_name, column_name, is_nullable from information_schema.columns
where table_schema = 'public' and column_name in ('token_nonce', 'chosen_artifact_id');

-- 3
select count(*) from pg_constraint
where conname in ('engagement_events_chosenArtifact_same_org_fk',
                  'engagement_events_chosen_artifact_only_concept',
                  'design_engagements_token_nonce_needs_hash');

-- 1 row
select indexdef from pg_indexes
where schemaname = 'public' and indexname = 'engagement_events_chosenArtifact_idx';

-- 1 row: trg_design_engagements_token_nonce | design_engagements | t
select t.tgname, c.relname, t.tgenabled <> 'D' as enabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where t.tgname = 'trg_design_engagements_token_nonce' and not t.tgisinternal;

-- 6 rows, one per function (no overload was added). The four existing ones
-- show exactly the arguments and results they had before this step:
--   app_delivery_by_token               p_hash text -> jsonb
--   app_delivery_respond_by_token       p_hash, p_action, p_note, p_name, p_ip, p_ua (all text) -> text
--   app_delivery_claim_payment_by_token p_hash, p_milestone_kind, p_note, p_name, p_ip, p_ua (all text) -> text
--   app_delivery_comment_by_token       p_hash text, p_document_id uuid, p_body, p_name, p_ip, p_ua (text) -> text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_by_token', 'app_delivery_respond_by_token',
                    'app_delivery_claim_payment_by_token', 'app_delivery_comment_by_token',
                    'app_delivery_choose_concept_by_token',
                    'app_delivery_notify_studio_by_token')
order by 1;

-- 2 rows, each: metra_app = true, public_grants = 0, anon = false,
-- authenticated = false, service_role = false
select f.sig,
       has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values
  ('public.app_delivery_choose_concept_by_token(text, uuid, text, text, text, text)'),
  ('public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)')
) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- true
select has_column_privilege('metra_app', 'public.design_engagements', 'token_nonce', 'UPDATE');

-- 0 and 0: nothing was backfilled
select (select count(*) from design_engagements where token_nonce is not null) as nonces,
       (select count(*) from engagement_events where chosen_artifact_id is not null) as choices;
```

**5. Set `SHARE_LINK_SECRET` on the Worker.** At least 32 random bytes, piped
straight into wrangler, so the value is never printed, never typed and never
in shell history (wrangler deploys from `apps/web`; any checkout works):

```powershell
cd C:\Users\HP\merta-main\apps\web
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler secret put SHARE_LINK_SECRET
npx wrangler secret list    # lists the NAME SHARE_LINK_SECRET, never a value
```

For local development, give the DEV checkout (`C:\Users\HP\merta`, not
`merta-main`) its OWN value in `apps/web/.env.local`, never the production one.
`.env*` is gitignored and must stay uncommitted:

```powershell
cd C:\Users\HP\merta\apps\web
node -e "require('fs').appendFileSync('.env.local', '\nSHARE_LINK_SECRET=' + require('crypto').randomBytes(48).toString('base64url') + '\n')"
```

Nothing reads the secret until PR-B11 is deployed. From then on, a link is
minted as HMAC(secret, engagement id + `token_nonce`), so the studio can send
the client's EXISTING link in a reminder. **If the secret is missing** (never
set, or set on the wrong Worker): every link keeps working, because the portal
resolves links by their stored hash; new links are minted as plain random
tokens with a NULL nonce; and "Show link" and "Send reminder" answer
`delivery_link_unrecoverable` and offer one confirmed replacement, which
without the secret is again not re-derivable. Links minted before PR-B11 have no
nonce whatever you do, so each needs one confirmed replacement the first time
a reminder is sent. **Do not rotate it casually** (see *Rotating a secret*).

**6. Afterwards: merge, in this order, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-b-combined` (the order and its reasons are at the top of
   this section). Merging deploys automatically: wait for the Deploy workflow
   to go green before the live checks. PR-B10 to PR-B12 merge after that.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**What you will notice between step 3 and the next deploy.** The deployed app
is unchanged, but the database already behaves the Round B way:

- the client of each delivery counted in step 2 (c) is offered "approve
  design" again on the link they already have, because their decision answered
  an earlier render issuance;
- a client act (approve, request changes, acknowledge, claim a payment,
  comment) now refreshes the delivery's `updated_at`, so the dashboard's
  oldest-first delivery panel ("since it moved") treats that delivery as just
  moved;
- nothing is notified yet: the notifier exists but nothing calls it until
  PR-B10 is deployed.

**Undo, if ever needed.** Undo the CODE, never the database:

1. **Roll the Worker back** with `npx wrangler rollback <version-id>` from
   `apps\web` (see *Rolling back* below). Every Worker version, before or after Round B, works
   on the Round B database: older code never names the new columns, and the
   trigger clears a stale nonce when older code rotates or revokes a link.
2. **Leave the database as it is.** Do NOT run `db:apply-rls` from an older
   `main` while any PR-B9-or-later code is serving: that run re-grants the
   15-column UPDATE list without `token_nonce`, and every revoke (and, after
   PR-B11, every mint and rotate) from the serving code then fails with 42501.
   It is only harmless once the serving Worker is older than PR-B9 again, and
   even then it buys nothing: the old functions it restores would bring back
   the studio and portal disagreement described at the top of this section if
   Wave 1 is still deployed.
3. If the two new functions must go regardless (only after step 1 has put a
   pre-PR-B10 Worker in place, since PR-B10 and PR-B12 call them):
   `drop function public.app_delivery_choose_concept_by_token(text, uuid,
   integer, text, text, text, text); drop function
   public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb);`. The
   choice function has had seven arguments since 0057 ([*0057 and the B12
   database step*](0057-b12.md)). The columns, constraints, index and trigger stay:
   dropping a column is the one non-additive change this file never makes.
