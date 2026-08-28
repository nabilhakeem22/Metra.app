-- 0034 — Client payment claims (Client Delivery Portal, Phase 3). SCHEMA ONLY:
-- one enum, one table (with a MUTABLE status lifecycle — NOT append-only), its FKs,
-- CHECK, and indexes (including a partial UNIQUE for one open claim per milestone).
-- Row-level security and grants (SELECT + INSERT + UPDATE — the studio confirm/dismiss
-- UPDATES status, unlike the append-only ledgers) live EXCLUSIVELY in
-- rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay (migrate -> apply-rls)
-- stays correct. This migration references NO apply-rls object (no metra_app, no
-- app_* function, no policy). Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- client_payment_claim_status enum. Guarded — CREATE TYPE has no IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'client_payment_claim_status'
  ) THEN
    CREATE TYPE public.client_payment_claim_status AS ENUM (
      'pending',
      'confirmed',
      'dismissed'
    );
  END IF;

  -- client_payment_claims (client "mark as paid" -> pending row; studio resolves
  -- to confirmed/dismissed). Cascades from the parent engagement; the confirmed
  -- payment ref is set null if that ledger row is ever removed.
  CREATE TABLE IF NOT EXISTS public.client_payment_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    milestone_kind public.milestone_kind NOT NULL,
    claimed_amount numeric(18, 4) NOT NULL,
    note text,
    actor_name text,
    actor_ip text,
    actor_user_agent text,
    status public.client_payment_claim_status DEFAULT 'pending' NOT NULL,
    confirmed_payment_event_id uuid,
    resolved_by uuid,
    resolved_at timestamptz,
    CONSTRAINT client_payment_claims_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT client_payment_claims_amount_positive CHECK (claimed_amount > 0),
    CONSTRAINT client_payment_claims_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT client_payment_claims_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade,
    CONSTRAINT client_payment_claims_confirmedPaymentEvent_same_org_fk
      FOREIGN KEY (org_id, confirmed_payment_event_id) REFERENCES public.payment_events (org_id, id) ON DELETE set null
  );
  CREATE INDEX IF NOT EXISTS client_payment_claims_engagement_idx
    ON public.client_payment_claims (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS "client_payment_claims_confirmedPaymentEvent_idx"
    ON public.client_payment_claims (org_id, confirmed_payment_event_id);
  CREATE INDEX IF NOT EXISTS client_payment_claims_org_engagement_status_idx
    ON public.client_payment_claims (org_id, engagement_id, status);
  -- One OPEN (pending) claim per milestone; a resolved claim frees the slot.
  CREATE UNIQUE INDEX IF NOT EXISTS client_payment_claims_pending_milestone_unique
    ON public.client_payment_claims (engagement_id, milestone_kind)
    WHERE status = 'pending';
END $$;
