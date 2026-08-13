-- 0015 — Project tabbed profile: editable project_types + org stage_templates +
-- per-project project_stages, plus projects columns (type_id, advance/retention,
-- contract_ref, description). SCHEMA + config backfill ONLY. Row-level security
-- and role grants live exclusively in rls/policies.sql + rls/roles.sql, so the
-- fresh-DB CI replay (migrate -> apply-rls) stays correct.
ALTER TYPE "public"."activity_kind" ADD VALUE IF NOT EXISTS 'project_created';--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- stage_status enum (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stage_status') THEN
    CREATE TYPE public.stage_status AS ENUM ('not_started', 'in_progress', 'blocked', 'done', 'skipped');
  END IF;

  -- 1) project_types (editable per-tenant classifications).
  CREATE TABLE IF NOT EXISTS public.project_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    key text,
    name_ar text,
    name_en text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT project_types_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT project_types_name_present CHECK (
      length(regexp_replace(coalesce(name_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(name_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT project_types_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE UNIQUE INDEX IF NOT EXISTS project_types_org_key_unique
    ON public.project_types (org_id, key) WHERE key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS project_types_org_active_idx
    ON public.project_types (org_id, active);

  -- 2) stage_templates (one editable org-wide process).
  CREATE TABLE IF NOT EXISTS public.stage_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    key text,
    name_ar text,
    name_en text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT stage_templates_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT stage_templates_name_present CHECK (
      length(regexp_replace(coalesce(name_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(name_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT stage_templates_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE UNIQUE INDEX IF NOT EXISTS stage_templates_org_key_unique
    ON public.stage_templates (org_id, key) WHERE key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS stage_templates_org_sort_idx
    ON public.stage_templates (org_id, sort_order);

  -- 3) projects columns (must precede project_stages' project FK use of them? no
  --    — the stage FK targets projects(org_id,id), already unique).
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS type_id uuid;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS contract_ref text;
  ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS description text;
  ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS advance_pct numeric(18, 4) NOT NULL DEFAULT '0';
  ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS retention_pct numeric(18, 4) NOT NULL DEFAULT '0';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_type_same_org_fk') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_type_same_org_fk
      FOREIGN KEY (org_id, type_id) REFERENCES public.project_types (org_id, id) ON DELETE set null;
  END IF;
  CREATE INDEX IF NOT EXISTS projects_type_idx ON public.projects (org_id, type_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_advance_pct_range') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_advance_pct_range CHECK (advance_pct >= 0 AND advance_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_retention_pct_range') THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_retention_pct_range CHECK (retention_pct >= 0 AND retention_pct <= 100);
  END IF;

  -- 4) project_stages (per-project, cascades from its project).
  CREATE TABLE IF NOT EXISTS public.project_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    stage_key text,
    name_ar text,
    name_en text,
    sort_order integer DEFAULT 0 NOT NULL,
    status public.stage_status DEFAULT 'not_started' NOT NULL,
    progress_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    start_date date,
    end_date date,
    CONSTRAINT project_stages_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT project_stages_name_present CHECK (
      length(regexp_replace(coalesce(name_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(name_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT project_stages_progress_range CHECK (progress_pct >= 0 AND progress_pct <= 100),
    CONSTRAINT project_stages_date_order CHECK (
      end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT project_stages_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT project_stages_project_same_org_fk
      FOREIGN KEY (org_id, project_id) REFERENCES public.projects (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS project_stages_org_project_sort_idx
    ON public.project_stages (org_id, project_id, sort_order);

  -- 5) Backfill the 5 default project types + 10 default stage templates per org.
  INSERT INTO public.project_types (org_id, key, name_en, name_ar, sort_order)
  SELECT o.id, d.key, d.name_en, d.name_ar, d.sort_order
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('villa', 'Villa', 'فيلا', 0),
    ('apartment', 'Apartment', 'شقة', 1),
    ('office', 'Office', 'مكتب', 2),
    ('retail', 'Retail', 'محل تجاري', 3),
    ('restaurant', 'Restaurant', 'مطعم', 4)
  ) AS d(key, name_en, name_ar, sort_order)
  ON CONFLICT (org_id, key) WHERE key IS NOT NULL DO NOTHING;

  INSERT INTO public.stage_templates (org_id, key, name_en, name_ar, sort_order)
  SELECT o.id, d.key, d.name_en, d.name_ar, d.sort_order
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('design_drawings', 'Design & drawings', 'التصميم والرسومات', 0),
    ('civil_demolition', 'Civil & demolition', 'الأعمال المدنية والهدم', 1),
    ('mep_first_fix', 'MEP first fix', 'التمديدات الأولية', 2),
    ('gypsum_plaster', 'Gypsum & plaster', 'الجبس والمحارة', 3),
    ('flooring_tiling', 'Flooring & tiling', 'الأرضيات والبلاط', 4),
    ('painting_finishes', 'Painting & finishes', 'الدهانات والتشطيبات', 5),
    ('joinery', 'Joinery', 'النجارة', 6),
    ('mep_second_fix', 'MEP second fix', 'التمديدات النهائية', 7),
    ('snagging', 'Snagging', 'المعالجات', 8),
    ('handover', 'Handover', 'التسليم', 9)
  ) AS d(key, name_en, name_ar, sort_order)
  ON CONFLICT (org_id, key) WHERE key IS NOT NULL DO NOTHING;
END $$;
