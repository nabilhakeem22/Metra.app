-- 0023 — Payment events ledger (Design-Engagement Machine, Step 4). SCHEMA ONLY:
-- one enum, one append-only table, FKs, index, CHECK. Row-level security and
-- grants (SELECT + INSERT only — append-only) live EXCLUSIVELY in
-- rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay (migrate ->
-- apply-rls) stays correct. This migration references NO apply-rls object (no
-- metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL block,
-- short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- payment_event_kind enum (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_event_kind') THEN
    CREATE TYPE public.payment_event_kind AS ENUM (
      'deposit',
      'gate_a',
      'gate_b',
      'balance',
      'revision_co'
    );
  END IF;

  -- payment_events (append-only ledger; a recorded payment is a cleared payment
  -- in the manual model; cascades from the parent engagement).
  CREATE TABLE IF NOT EXISTS public.payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    kind public.payment_event_kind NOT NULL,
    amount numeric(18, 4) NOT NULL,
    method text,
    reference text,
    cleared_at timestamptz DEFAULT now() NOT NULL,
    recorded_by uuid NOT NULL,
    note text,
    CONSTRAINT payment_events_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT payment_events_amount_positive CHECK (amount > 0),
    CONSTRAINT payment_events_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT payment_events_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS payment_events_engagement_idx
    ON public.payment_events (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS payment_events_org_engagement_kind_idx
    ON public.payment_events (org_id, engagement_id, kind);
END $$;
