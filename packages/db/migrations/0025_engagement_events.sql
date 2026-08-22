-- 0025 — Engagement approvals ledger (Design-Engagement Machine, Step 7). SCHEMA
-- ONLY: one enum, one append-only table, FKs, index. Row-level security and grants
-- (SELECT + INSERT only — append-only) live EXCLUSIVELY in rls/policies.sql +
-- rls/roles.sql, so the fresh-DB CI replay (migrate -> apply-rls) stays correct.
-- This migration references NO apply-rls object (no metra_app, no app_* function,
-- no policy). Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- engagement_event_kind enum. The FULL set is declared now (concept_approval is
  -- the only one written this step) to avoid a later enum-add migration. Guarded —
  -- CREATE TYPE has no IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'engagement_event_kind'
  ) THEN
    CREATE TYPE public.engagement_event_kind AS ENUM (
      'concept_approval',
      'design_approval',
      'rom_acknowledgement',
      'handoff_acknowledgement'
    );
  END IF;

  -- engagement_events (append-only approvals ledger; cascades from the parent
  -- engagement). actor_user_id + actor_name/ip/user_agent are nullable, reserved
  -- for the future tokenized client-ack path; range_low/range_high are reserved
  -- for rom_acknowledgement.
  CREATE TABLE IF NOT EXISTS public.engagement_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    kind public.engagement_event_kind NOT NULL,
    actor_user_id uuid,
    actor_name text,
    actor_ip text,
    actor_user_agent text,
    range_low numeric(18, 4),
    range_high numeric(18, 4),
    doc_hash text,
    note text,
    decided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT engagement_events_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_events_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_events_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS engagement_events_engagement_idx
    ON public.engagement_events (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS engagement_events_org_engagement_kind_idx
    ON public.engagement_events (org_id, engagement_id, kind);
END $$;
