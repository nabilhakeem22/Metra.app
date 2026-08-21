-- 0022 — Engagement fee schedule (Design-Engagement Machine, Step 3). SCHEMA
-- ONLY: two enums, one column, one table, FKs, index, CHECKs. Row-level security
-- and grants live EXCLUSIVELY in rls/policies.sql + rls/roles.sql — so the
-- fresh-DB CI replay (migrate -> apply-rls) stays correct. This migration
-- references NO apply-rls object (no metra_app, no app_* function, no policy).
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- milestone_kind enum (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'milestone_kind') THEN
    CREATE TYPE public.milestone_kind AS ENUM (
      'deposit',
      'gate_a',
      'gate_b',
      'balance'
    );
  END IF;

  -- milestone_basis enum (guarded).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'milestone_basis') THEN
    CREATE TYPE public.milestone_basis AS ENUM (
      'percent',
      'amount'
    );
  END IF;

  -- 1) design_engagements.design_fee — set when submitDesignFee fires (Step 3).
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS design_fee numeric(18, 4);

  -- 2) engagement_milestones (one row per milestone kind per engagement; editable
  --    while the fee is being set up, cascades from the parent engagement).
  CREATE TABLE IF NOT EXISTS public.engagement_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    kind public.milestone_kind NOT NULL,
    basis public.milestone_basis NOT NULL,
    value numeric(18, 4) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT engagement_milestones_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_milestones_org_engagement_kind_unique UNIQUE (org_id, engagement_id, kind),
    CONSTRAINT engagement_milestones_value_nonneg CHECK (value >= 0),
    CONSTRAINT engagement_milestones_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_milestones_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS engagement_milestones_engagement_idx
    ON public.engagement_milestones (org_id, engagement_id);
END $$;
