-- 0057: Round B, PR-B12: the letter the client saw, and the feed index.
-- SCHEMA ONLY: one nullable column, two CHECKs, one index. Additive and
-- idempotent; no backfill, no data touched, no enum label added, no policy, no
-- grant and no apply-rls function referenced (those live in rls/ and are
-- applied by `db:apply-rls` AFTER this file).
--
-- engagement_events.chosen_position: the option LETTER (1 = A to 4 = D) the
--   client saw on the option they chose. Letters rank only the options the
--   client can see right now, so hiding or releasing one renumbers the others;
--   the choice therefore SAVES the letter it was made under, and every reader
--   ("you chose option B", "Client chose option B") shows this column and
--   never re-ranks. NULL on every row that names no option.
--
-- engagement_events_chosen_position_pairs: a chosen option always carries its
--   letter and a letter always names an option. Production holds no row with
--   chosen_artifact_id set (nothing deployed has ever called the choose
--   function, and the offline approval refuses a choice), so the CHECK holds
--   for every existing row. If one exists, this file fails with 23514 and the
--   whole batch rolls back: nothing changes.
--
-- engagement_events_chosen_position_range: the letter is 1 to 4 (A to D).
--
-- notifications_org_recipient_created_idx: the bell and the notifications
--   page read a recipient's NEWEST rows (`order by created_at desc limit n`).
--   notifications_org_recipient_read_idx serves the unread count, not that
--   order, so every feed load sorted all of the recipient's rows. NOT built
--   CONCURRENTLY: the migrator runs the batch in ONE transaction, where
--   CONCURRENTLY is refused (25001). Above 200,000 notification rows the owner
--   pre-builds it CONCURRENTLY from the SQL editor (docs/DEPLOY.md) and the
--   IF NOT EXISTS below makes this statement a no-op.
--
-- LOCKS. The ADD COLUMN is metadata-only (nullable, no default) but takes
-- ACCESS EXCLUSIVE on engagement_events, and `db:migrate` runs the batch as
-- ONE transaction, so the ledger is closed to reads and writes until the batch
-- commits; inside that window both CHECKs scan it once each. The index build
-- takes SHARE on notifications: new notifications and mark-as-read wait,
-- reads continue. Both tables are small at pilot volume, so the file is well
-- inside the migrator's 3 s lock_timeout, which each block re-asserts so a
-- long reader makes it fail fast with 55P03 instead of queueing every writer
-- behind it. Re-runnable: every statement is IF NOT EXISTS or guarded by
-- pg_constraint.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.engagement_events ADD COLUMN IF NOT EXISTS chosen_position smallint;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_chosen_position_pairs'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_chosen_position_pairs
      CHECK ((chosen_artifact_id IS NULL) = (chosen_position IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_chosen_position_range'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_chosen_position_range
      CHECK (chosen_position IS NULL OR chosen_position BETWEEN 1 AND 4);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  CREATE INDEX IF NOT EXISTS notifications_org_recipient_created_idx
    ON public.notifications (org_id, recipient_user_id, created_at DESC);
END $$;
