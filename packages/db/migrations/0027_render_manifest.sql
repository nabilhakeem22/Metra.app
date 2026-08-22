-- 0027 — Render manifest baseline (Design-Engagement Machine, Step 11). SCHEMA
-- ONLY: two nullable columns on design_engagements — `render_manifest_hash` (the
-- sha256 of the sorted approved-render content-hash list, stamped when
-- `rendersReady` fires) and `renders_ready_at` (the moment the render baseline was
-- captured). No new table, no enum, no RLS change: the existing design_engagements
-- org_isolation policy + grants already cover these columns, so nothing new lands
-- in rls/policies.sql or rls/roles.sql. This migration references NO apply-rls
-- object (no metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL
-- block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS render_manifest_hash text;
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS renders_ready_at timestamptz;
END $$;
