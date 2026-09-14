-- 0049 — a client ROM acknowledgement belongs to ONE ISSUANCE. SCHEMA ONLY: one
-- nullable timestamp + two partial unique indexes. Additive, idempotent, no
-- backfill. NO ENUM LABEL IS NAMED ANYWHERE IN THIS FILE (0048's ADD VALUE is
-- unusable in the same transaction on a fresh DB): both indexes key on the kind
-- COLUMN and acknowledged_issue_at.
--
-- THE PROBLEM. 0048 made issuing a build-cost band a deliberate, dated act. What
-- it could not fix on its own is the acknowledgement: the partial unique index
-- from 0033 allows ONE client signal of each kind per engagement, for all time.
-- So once a client had acknowledged a band, the studio could revise it, issue the
-- new numbers, and the portal would still consider the acknowledgement done. The
-- client would have agreed to one figure and be recorded as agreeing to another,
-- on the record that exists precisely to say what they agreed to.
--
-- acknowledged_issue_at is the answer: a copy of the issuance instant the client
-- was looking at when they acknowledged. It is a SNAPSHOT, not a foreign key to
-- the issuance event — the band can be re-issued and the row must still say which
-- instant it belonged to, without depending on another row surviving.
--
-- Two partial indexes, because the column is nullable and NULLs do not collide:
--   * the NULL half preserves 0033 exactly, for every signal kind that is not
--     tied to an issuance (one per engagement, for all time);
--   * the NOT NULL half admits one acknowledgement PER ISSUANCE INSTANT, so a
--     re-issued band can be acknowledged again and a double submit of the SAME
--     issuance still cannot write twice.
--
-- NO BACKFILL. A pre-existing acknowledgement has a NULL here, which reads as
-- "we do not know which figures they saw" — and that is the truth. Stamping
-- rom_issued_at onto it would be inventing evidence on an evidentiary record.
-- The guard therefore fails for those rows and the portal re-offers the verb,
-- which is the safe direction. See docs/DEPLOY.md for the count query.
--
-- lock_timeout: the DROP/CREATE INDEX pair needs a brief ACCESS EXCLUSIVE lock on
-- engagement_events. Behind a long reader it would queue and block every writer
-- behind it; 3s makes it fail fast with 55P03 instead, and the migration can be
-- re-run (every statement is IF EXISTS / IF NOT EXISTS).
--
-- RLS/grants unchanged: org_isolation and the append-only grants already cover a
-- new column, and an index carries no privileges.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.engagement_events ADD COLUMN IF NOT EXISTS acknowledged_issue_at timestamptz;
  DROP INDEX IF EXISTS public.engagement_events_client_signal_unique;
  CREATE UNIQUE INDEX IF NOT EXISTS engagement_events_client_signal_unique
    ON public.engagement_events (engagement_id, kind)
    WHERE actor_channel = 'client' AND acknowledged_issue_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS engagement_events_client_issuance_unique
    ON public.engagement_events (engagement_id, kind, acknowledged_issue_at)
    WHERE actor_channel = 'client' AND acknowledged_issue_at IS NOT NULL;
END $$;
