-- 0021 — Design Engagements (Design-Engagement Machine, Step 1). SCHEMA ONLY:
-- enum, tables, FKs, indexes, CHECKs. Row-level security, grants and (Step 2)
-- transition triggers live EXCLUSIVELY in rls/policies.sql + rls/roles.sql — so
-- the fresh-DB CI replay (migrate -> apply-rls) stays correct. This migration
-- references NO apply-rls object (no metra_app, no app_* function, no policy).
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- design_engagement_state enum (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_engagement_state') THEN
    CREATE TYPE public.design_engagement_state AS ENUM (
      'created',
      'design_proposal',
      'survey',
      'layout',
      'concept_review',
      'negotiation',
      'design_3d',
      'final_approval',
      'shop_drawings',
      'boq',
      'execution_decision',
      'design_only_handoff',
      'closed_design_only',
      'execution',
      'abandoned'
    );
  END IF;

  -- 1) design_engagements (one record per client design job; created in 'created').
  CREATE TABLE IF NOT EXISTS public.design_engagements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    number integer NOT NULL,
    title_ar text,
    title_en text,
    client_id uuid NOT NULL,
    project_id uuid NOT NULL,
    state public.design_engagement_state DEFAULT 'created' NOT NULL,
    off_plan boolean DEFAULT false NOT NULL,
    as_built_due boolean DEFAULT false NOT NULL,
    free_revision_n integer DEFAULT 3 NOT NULL,
    revision_count integer DEFAULT 0 NOT NULL,
    rom_low numeric(18, 4),
    rom_high numeric(18, 4),
    concept_locked_at timestamptz,
    token_hash text,
    share_expires_at timestamptz,
    CONSTRAINT design_engagements_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT design_engagements_org_id_number_unique UNIQUE (org_id, number),
    CONSTRAINT design_engagements_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT design_engagements_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT design_engagements_rom_range CHECK (
      rom_high IS NULL OR rom_low IS NULL OR rom_high >= rom_low
    ),
    CONSTRAINT design_engagements_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT design_engagements_client_same_org_fk
      FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE restrict,
    CONSTRAINT design_engagements_project_same_org_fk
      FOREIGN KEY (org_id, project_id) REFERENCES public.projects (org_id, id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS design_engagements_client_idx ON public.design_engagements (org_id, client_id);
  CREATE INDEX IF NOT EXISTS design_engagements_project_idx ON public.design_engagements (org_id, project_id);
  CREATE INDEX IF NOT EXISTS design_engagements_org_state_idx ON public.design_engagements (org_id, state);
  CREATE INDEX IF NOT EXISTS design_engagements_org_project_idx ON public.design_engagements (org_id, project_id);

  -- 2) engagement_transitions (append-only lifecycle ledger; empty until Step 2).
  CREATE TABLE IF NOT EXISTS public.engagement_transitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    trigger text,
    from_state public.design_engagement_state,
    to_state public.design_engagement_state,
    actor_user_id uuid,
    note text,
    decided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT engagement_transitions_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_transitions_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_transitions_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS engagement_transitions_engagement_idx
    ON public.engagement_transitions (org_id, engagement_id);
END $$;
