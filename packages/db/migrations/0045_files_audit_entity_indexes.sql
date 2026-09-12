-- 0045 — the two indexes for the only way `files` and `audit_log` are ever
-- read. SCHEMA ONLY: two CREATE INDEX IF NOT EXISTS, nothing else. No data
-- touched, no backfill, no apply-rls object referenced.
--
-- THE PROBLEM. Both tables are polymorphic: a row is addressed by
-- (org_id, entity, entity_id) — "the documents filed on this client", "the
-- history of this contract". That is the shape of essentially every query
-- either table receives. Neither had an index on it. `files` had
-- unique(org_id,id) and unique(object_key); `audit_log` had only
-- unique(org_id,id). So opening a client's Documents tab, or a record's
-- activity timeline, meant a sequential scan of every file or every audit row
-- in the database, with RLS filtering afterwards — and audit_log is
-- append-only and never pruned, so it is the fastest-growing table here and
-- the scan gets worse every day the product is used.
--
-- audit_log's index carries `at` as a fourth column, after the three equality
-- columns. An audit read is always "this record's history, newest first", so
-- the trailing sort key lets the same index supply the ordering and avoids a
-- sort on top of the lookup.
--
-- PLAIN CREATE INDEX, NOT CONCURRENTLY. The drizzle migrator may run all
-- pending migrations inside a single transaction, and CREATE INDEX
-- CONCURRENTLY cannot run in one. The write lock is acceptable here: these
-- tables are small at pilot scale, and the alternative — hand-applying the
-- index outside the migration chain — leaves a fresh CI database without it
-- and the schema no longer described by its own migrations.
--
-- IF NOT EXISTS on both so a re-run is a no-op.
CREATE INDEX IF NOT EXISTS files_org_entity_idx
  ON public.files (org_id, entity, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_org_entity_at_idx
  ON public.audit_log (org_id, entity, entity_id, at);
