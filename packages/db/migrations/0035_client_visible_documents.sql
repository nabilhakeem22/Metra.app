-- 0035 — Client-visible documents (Client Deliverables, Step 1). SCHEMA ONLY: one
-- boolean column on engagement_artifacts (`client_visible`, default false — every
-- existing artifact stays hidden from the client portal) plus a partial index over
-- the visible rows so the portal's per-engagement document read stays cheap. No new
-- table, no enum, no RLS change: the existing engagement_artifacts org_isolation
-- policy and its SELECT/INSERT/UPDATE grants already cover this column, so nothing
-- new lands in rls/policies.sql or rls/roles.sql. This migration references NO
-- apply-rls object (no metra_app, no app_* function, no policy). Idempotent, one
-- PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.engagement_artifacts
    ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;

  CREATE INDEX IF NOT EXISTS engagement_artifacts_client_visible_idx
    ON public.engagement_artifacts (org_id, engagement_id) WHERE client_visible;
END $$;
