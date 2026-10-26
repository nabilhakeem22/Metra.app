-- 0066: client codes DB step D. SCHEMA ONLY and ADDITIVE: one partial index on
-- client_verification_codes. No row is updated, nothing is backfilled, no
-- policy, no grant, no trigger and no apply-rls function is referenced.
--
-- WHAT IT ADDS.
--   * client_verification_codes_unused_created_idx: the codes never used, by
--     when they were made. app_home_code_issue_by_token purges at most 50 of
--     them that expired more than 90 days ago with every code it makes (H3
--     reliability R5); a used code is evidence and is never purged. Without
--     this index that purge walks client_verification_codes_created_idx past
--     every used code first (H3 round 2 re-check, L1). Not needed at pilot
--     volume; cheap to build now, while the table is tiny.
--
-- WHY NOT CONCURRENTLY. `db:migrate` runs the batch as ONE transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. A plain
-- build holds a SHARE lock on the table for the build: code issues and code
-- acts (which insert and update rows) wait for it, then continue. The table
-- holds 0 rows in production (docs/DEPLOY.md, client codes DB step D), so the
-- build takes milliseconds.
--
-- LOCKS, ALL OR NONE (the 0064 and 0065 pattern). The block below takes the one
-- lock this file needs on an EXISTING table, SHARE on client_verification_codes,
-- as an attempt of `LOCK TABLE ... NOWAIT` inside a subtransaction. An attempt
-- that meets a busy table rolls back, sleeps 10 to 40 ms and tries again,
-- within ONE 3 s budget in all; a spent budget is 55P03 and the batch rolls
-- back whole. So the migration never queues behind a code act holding a row
-- (and never makes every later code act queue behind it while it waits).
DO $$
DECLARE
  lock_started constant timestamptz := clock_timestamp();
  lock_targets constant text[] := array[
    'public.client_verification_codes:SHARE'
  ];
  lock_target  text;
BEGIN
  -- EVERY LOCK, ALL OR NONE, within ONE 3 s budget for all the attempts
  -- together. The inner BEGIN ... EXCEPTION is a subtransaction: when the
  -- NOWAIT finds the table busy, nothing is held between attempts.
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
  -- The lock is held now; the build below waits on nothing.

  CREATE INDEX client_verification_codes_unused_created_idx
    ON public.client_verification_codes USING btree (created_at) WHERE consumed_at is null;
END $$;
