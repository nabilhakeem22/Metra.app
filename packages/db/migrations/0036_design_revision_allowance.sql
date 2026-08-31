-- 0036 — Independent 3D revision allowance. SCHEMA ONLY: two integer columns on
-- design_engagements — `design_revision_count` (default 0) and
-- `free_design_revision_n` (default 3) — mirroring the existing concept pair
-- (`revision_count` / `free_revision_n`). The `designChangeRaised` 3D revision loop
-- spends THIS pair, so burning the free concept revisions no longer costs the
-- client their free 3D revisions. Existing rows take the defaults, which is the
-- intended behaviour: an in-flight engagement starts with a full 3D allowance. No
-- new table, no enum, no RLS change: the existing design_engagements org_isolation
-- policy and its grants already cover these columns, so nothing new lands in
-- rls/policies.sql or rls/roles.sql. This migration references NO apply-rls object
-- (no metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL block,
-- short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS free_design_revision_n integer NOT NULL DEFAULT 3;
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS design_revision_count integer NOT NULL DEFAULT 0;
END $$;
