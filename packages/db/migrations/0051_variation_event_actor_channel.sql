-- 0051 — WHO decided a variation order. SCHEMA ONLY: one nullable text column
-- with an inline CHECK. Additive, idempotent, NO BACKFILL, no apply-rls object
-- referenced, NO ENUM LABEL NAMED.
--
-- THE PROBLEM. A variation order reaches `rejected` by exactly TWO routes, and
-- they are different commercial facts:
--   1. the CLIENT refused it, through the token-path decision function in
--      rls/functions.sql;
--   2. the contract was TERMINATED and the cascade closed every open VO with it
--      (`variations/lifecycle/terminate-rejection.ts`).
-- Nothing recorded which, so the portal guessed from the parent contract's
-- status and guessed wrong for the one case that matters: a client who rejected
-- a VO and then saw the contract terminated was told "this contract is no longer
-- in force" — the page denied the decision they had made and recorded. The
-- studio's own register could not tell the two apart either.
--
-- WHY THE COLUMN LIVES ON THE EVENT LEDGER AND NOT ON `variation_orders`.
-- `trg_variation_orders_immutable` (rls/policies.sql) runs
-- `enforce_immutable_when`, which compares `to_jsonb(NEW) - status -
-- updated_at` with OLD: a locked VO row may change its STATUS and its
-- UPDATED_AT and nothing else. A provenance column on the VO row would
-- therefore raise MT100 on the cascade UPDATE — the exact write that needs to
-- record it. `engagement_events.actor_channel` already solved the identical
-- problem for the engagement machine, and this column takes its name and its
-- vocabulary ('staff' / 'client') verbatim so one concept keeps one word.
--
-- NULLABLE, WITH NO DEFAULT, DELIBERATELY UNLIKE `engagement_events` (whose
-- `not null default 'staff'` is only safe because it was there from row one).
-- NULL means "we did not record which channel decided this", which is the truth
-- for every row written before today. THERE IS NO BACKFILL: every discriminator
-- one could use (actor_user_id, ip, user_agent, from_status) is nullable on BOTH
-- paths, so a backfill would be a guess stamped onto an evidentiary record. The
-- read ladder falls back to today's ordering for NULL, so no historical page
-- changes its wording.
--
-- The CHECK is INLINE in the ADD COLUMN — one statement, so no later statement
-- in this transaction reads a column an earlier one added. No enum type is
-- involved at all.
--
-- lock_timeout: ADD COLUMN of a nullable text is a catalogue-only change in
-- PG11+ (no table rewrite), but it still needs a brief ACCESS EXCLUSIVE lock. 3s
-- makes it fail fast with 55P03 behind a long reader rather than queue every
-- writer behind it; the statement is IF NOT EXISTS, so a re-run is safe.
--
-- RLS and privileges unchanged, and NOTHING from apply-rls is referenced or
-- required here: `org_isolation` and the table-level append-only privileges
-- (select + insert, no update, no delete) already cover a new column.
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.variation_order_events
    ADD COLUMN IF NOT EXISTS actor_channel text
    CONSTRAINT variation_order_events_actor_channel_check
      CHECK (actor_channel IS NULL OR actor_channel IN ('staff', 'client'));
END $$;
