-- 0056 — Round B: the studio hears the client. SCHEMA ONLY: two nullable
-- columns, two CHECKs, one composite same-org FK, one index. Additive and
-- idempotent; no backfill, no data touched, no enum label added, no policy, no
-- grant and no apply-rls function referenced (those live in rls/ and are
-- applied by `db:apply-rls` AFTER this file).
--
-- design_engagements.token_nonce — the per-link random value the raw share
--   token is RE-DERIVED from: raw = HMAC(SHARE_LINK_SECRET, engagement id +
--   nonce). It lets a reminder carry the link the client already holds instead
--   of rotating it. A database read alone still opens nothing: the secret lives
--   only on the Worker. NULL for every link minted before this migration (those
--   cannot be re-derived and need one confirmed replacement), for a link minted
--   while the secret is absent, and whenever there is no link at all.
--
-- design_engagements_token_nonce_needs_hash — a nonce without a hash is a
--   re-derivable link that no longer exists. Revoke must clear both, and this
--   says so at the database. Every existing row has a NULL nonce, so the CHECK
--   holds for all of them.
--
-- engagement_events.chosen_artifact_id — WHICH concept option a client (or the
--   studio, recording an offline choice) approved. A pointer to the
--   `concept_option` artifact, same-org by the composite FK.
--
-- engagement_events_chosenArtifact_same_org_fk — ON DELETE NO ACTION, not
--   RESTRICT: deleting a delivery cascades to its events AND its artifacts in
--   ONE statement. NO ACTION is checked at the end of that statement, when the
--   referencing event is already gone; RESTRICT is checked immediately and would
--   refuse the delivery delete whenever an event named an option.
--
-- engagement_events_chosen_artifact_only_concept — only a concept approval may
--   name an option, so no reader has to defend against a design approval that
--   carries one. It compares `kind::text` (0043's reason: a CHECK that resolves
--   an enum label is fragile against ADD VALUE in the same transaction).
--
-- NAMES are the exact `sameOrgFk` spellings. The camelCase ones are
-- DOUBLE-QUOTED so Postgres keeps them (0053's header: unquoted camelCase folds
-- to lower case and `migration-catalogue.test.ts` goes red).
--
-- LOCKS. Each ADD COLUMN is metadata-only (nullable, no default). The
-- design_engagements CHECK scans that table under ACCESS EXCLUSIVE (one row per
-- delivery). On engagement_events the FK validates an all-NULL column (no
-- lookups), the CHECK scans the ledger, and the index build holds SHARE (writes
-- wait, reads continue) for one pass over it. The ledger is small (tens of rows
-- per delivery), so the whole file is well inside the migrator's 3 s
-- lock_timeout, which each block re-asserts so a long reader makes it fail fast
-- with 55P03 instead of queueing every writer behind it. Re-runnable: every
-- statement is IF NOT EXISTS or guarded by pg_constraint.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.design_engagements ADD COLUMN IF NOT EXISTS token_nonce text;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'design_engagements_token_nonce_needs_hash'
  ) THEN
    ALTER TABLE public.design_engagements
      ADD CONSTRAINT design_engagements_token_nonce_needs_hash
      CHECK (token_nonce IS NULL OR token_hash IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.engagement_events ADD COLUMN IF NOT EXISTS chosen_artifact_id uuid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_chosenArtifact_same_org_fk'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT "engagement_events_chosenArtifact_same_org_fk"
      FOREIGN KEY (org_id, chosen_artifact_id)
      REFERENCES public.engagement_artifacts (org_id, id)
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_chosen_artifact_only_concept'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_chosen_artifact_only_concept
      CHECK (chosen_artifact_id IS NULL OR kind::text = 'concept_approval');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  CREATE INDEX IF NOT EXISTS "engagement_events_chosenArtifact_idx"
    ON public.engagement_events (org_id, chosen_artifact_id);
END $$;
