-- 0066: client codes DB step D. SCHEMA ONLY and ADDITIVE: one column on
-- design_engagements and one partial index on client_verification_codes. No
-- row is updated, nothing is backfilled, no policy, no grant, no trigger and
-- no apply-rls function is referenced (the reset that writes the column and
-- the purge that reads the index live in rls/functions/75-client-home.sql,
-- applied by `db:apply-rls` AFTER this file).
--
-- WHAT IT ADDS.
--   * design_engagements.client_codes_reset_at: when an owner or admin last
--     reset the client's one-time codes (H5 security S1). Every code made
--     before it no longer works, and the delivery's own code limits count from
--     it, so a link holder who used up the delivery's day can be undone by the
--     studio. NULL for every existing row (no default: catalogue only, no row
--     is rewritten).
--   * client_verification_codes_unused_created_idx: the codes never used, and
--     the codes never sent (marked used by their own id), by when they were
--     made. app_home_code_issue_by_token purges at most 50 of them that expired
--     more than 90 days ago with every code it makes (H3 reliability R5); a
--     used code is evidence and is never purged. Without this index that purge
--     walks client_verification_codes_created_idx past every used code first
--     (H3 round 2 re-check, L1).
--
-- WHY NOT CONCURRENTLY. `db:migrate` runs the batch as ONE transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. A plain
-- build holds a SHARE lock on the table for the build: code issues and code
-- acts (which insert and update rows) wait for it, then continue. The table
-- holds 0 rows in production (docs/DEPLOY.md, client codes DB step D), so the
-- build takes milliseconds.
--
-- LOCKS, ALL OR NONE (the 0064 and 0065 pattern). The block below takes EVERY
-- lock this file needs on an EXISTING table, ACCESS EXCLUSIVE on
-- design_engagements (its column) and SHARE on client_verification_codes (the
-- index), in the order the client home's functions read them, as ONE attempt
-- of two `LOCK TABLE ... NOWAIT` inside a subtransaction. An attempt that meets
-- a busy table rolls back, which RELEASES the lock it already took, sleeps 10
-- to 40 ms and tries again, within ONE 3 s budget in all; a spent budget is
-- 55P03 and the batch rolls back whole. So the migration never queues behind a
-- page read or a code act (and never makes the next ones queue behind it while
-- it waits). Then, held to the commit: one metadata-only ADD COLUMN and one
-- index build on an empty table.
DO $$
DECLARE
  lock_started constant timestamptz := clock_timestamp();
  lock_targets constant text[] := array[
    'public.design_engagements:ACCESS EXCLUSIVE',
    'public.client_verification_codes:SHARE'
  ];
  lock_target  text;
BEGIN
  -- EVERY LOCK, ALL OR NONE, within ONE 3 s budget for all the attempts
  -- together. The inner BEGIN ... EXCEPTION is a subtransaction: when one
  -- NOWAIT finds its table busy, the locks this attempt already took are
  -- released with it, so nothing is held between attempts.
  LOOP
    BEGIN
      FOREACH lock_target IN ARRAY lock_targets LOOP
        EXECUTE format('LOCK TABLE %s IN %s MODE NOWAIT', split_part(lock_target, ':', 1), split_part(lock_target, ':', 2));
      END LOOP;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() - lock_started >= interval '3 seconds' THEN
        RAISE EXCEPTION '0066: could not take every lock within 3 s (stopped at %)', lock_target
          USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.01 + random() * 0.03);
    END;
  END LOOP;
  -- Every lock is held now; the statements below wait on nothing.

  ALTER TABLE public.design_engagements ADD COLUMN client_codes_reset_at timestamp with time zone;

  CREATE INDEX client_verification_codes_unused_created_idx
    ON public.client_verification_codes USING btree (created_at) WHERE consumed_at is null or result_ref = id;
END $$;
