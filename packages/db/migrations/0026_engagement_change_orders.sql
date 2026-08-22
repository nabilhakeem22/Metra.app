-- 0026 — Engagement change orders (Design-Engagement Machine, Step 8). SCHEMA
-- ONLY: one enum, one table, FKs, CHECK, index. Row-level security and grants
-- (SELECT + INSERT + UPDATE — update reserved for the Step-9 settle path) live
-- EXCLUSIVELY in rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay
-- (migrate -> apply-rls) stays correct. This migration references NO apply-rls
-- object (no metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL
-- block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- change_order_status enum. Guarded — CREATE TYPE has no IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'change_order_status'
  ) THEN
    CREATE TYPE public.change_order_status AS ENUM (
      'raised',
      'settled'
    );
  END IF;

  -- engagement_change_orders. A change order is raised when a requestRevision
  -- self-loop crosses the free-revision allowance; amount is scale-4 money with a
  -- DB CHECK > 0. NOT append-only (status raised->settled in Step 9), but this
  -- step only INSERTs raised rows. Cascades from the parent engagement.
  CREATE TABLE IF NOT EXISTS public.engagement_change_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    amount numeric(18, 4) NOT NULL,
    reason text,
    status public.change_order_status DEFAULT 'raised' NOT NULL,
    raised_by_user_id uuid NOT NULL,
    raised_at timestamptz DEFAULT now() NOT NULL,
    settled_at timestamptz,
    CONSTRAINT engagement_change_orders_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_change_orders_amount_positive CHECK (amount > 0),
    CONSTRAINT engagement_change_orders_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_change_orders_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS engagement_change_orders_engagement_idx
    ON public.engagement_change_orders (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS engagement_change_orders_org_engagement_status_idx
    ON public.engagement_change_orders (org_id, engagement_id, status);
END $$;
