-- 0032 — One-active-delivery-per-project backstop (Design-Engagement Machine,
-- Slice C2-hardening). SCHEMA ONLY: one partial UNIQUE index that makes the
-- "at most one in-flight Delivery per project" invariant atomic at the database
-- level. The application already refuses a duplicate via a read-guard in
-- createEngagementCore, but two concurrent creates can both pass that read; this
-- index is the race backstop. Partial: only NON-terminal rows participate, so a
-- project whose deliveries are all TERMINAL (closed_design_only / execution /
-- abandoned) can always start a fresh one. Idempotent, non-concurrent, one
-- PL/pgSQL block, short lock_timeout — mirrors 0031's structure. References NO
-- apply-rls object; row-level security and role privileges live EXCLUSIVELY in
-- the apply-rls sources.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- At most one ACTIVE (non-terminal) delivery per (org, project). Terminal
  -- deliveries are excluded from the index, so they never block a fresh start.
  CREATE UNIQUE INDEX IF NOT EXISTS design_engagements_one_active_per_project_uniq
    ON public.design_engagements (org_id, project_id)
    WHERE state NOT IN ('closed_design_only', 'execution', 'abandoned');
END $$;
