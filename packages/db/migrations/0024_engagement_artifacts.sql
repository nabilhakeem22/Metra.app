-- 0024 — Engagement artifacts (Design-Engagement Machine, Step 5). SCHEMA ONLY:
-- one enum, one table, FKs, index. Row-level security and grants (SELECT +
-- INSERT + UPDATE — artifacts may be re-attested / relabelled) live EXCLUSIVELY
-- in rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay (migrate ->
-- apply-rls) stays correct. This migration references NO apply-rls object (no
-- metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL block,
-- short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- engagement_artifact_kind enum. The FULL set is declared now (survey/autocad
  -- are the only ones written this step) to avoid a later enum-add migration.
  -- Guarded — CREATE TYPE has no IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'engagement_artifact_kind'
  ) THEN
    CREATE TYPE public.engagement_artifact_kind AS ENUM (
      'survey',
      'autocad',
      'concept_option',
      'approved_render',
      'shop_drawing',
      'boq'
    );
  END IF;

  -- engagement_artifacts (re-attestable metadata records; cascades from the
  -- parent engagement). file_id is a plain nullable uuid — NO FK to files this
  -- step, the upload flow is not wired yet.
  CREATE TABLE IF NOT EXISTS public.engagement_artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    kind public.engagement_artifact_kind NOT NULL,
    file_id uuid,
    content_hash text,
    label text,
    attested_by uuid NOT NULL,
    attested_at timestamptz DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT engagement_artifacts_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_artifacts_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_artifacts_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS engagement_artifacts_engagement_idx
    ON public.engagement_artifacts (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS engagement_artifacts_org_engagement_kind_idx
    ON public.engagement_artifacts (org_id, engagement_id, kind);
END $$;
