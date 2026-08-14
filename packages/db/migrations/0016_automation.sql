-- 0016 — Automation: in-app notifications, per-org automation_settings, and the
-- append-only automation_run_log idempotency claim table. SCHEMA + config
-- backfill ONLY. Row-level security and role grants live exclusively in
-- rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay (migrate ->
-- apply-rls) stays correct. Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- 1) notifications (recipient-scoped in-app feed).
  CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    recipient_user_id uuid NOT NULL,
    kind text NOT NULL,
    entity_type text,
    entity_id uuid,
    body_key text NOT NULL,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at timestamptz,
    CONSTRAINT notifications_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT notifications_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS notifications_org_recipient_read_idx
    ON public.notifications (org_id, recipient_user_id, read_at);

  -- 2) automation_settings (one row per org).
  CREATE TABLE IF NOT EXISTS public.automation_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    expire_enabled boolean NOT NULL DEFAULT true,
    expire_nudge_enabled boolean NOT NULL DEFAULT false,
    expire_nudge_lead_days integer NOT NULL DEFAULT 3,
    followup_enabled boolean NOT NULL DEFAULT true,
    followup_threshold_days integer NOT NULL DEFAULT 5,
    digest_enabled boolean NOT NULL DEFAULT true,
    digest_cadence text NOT NULL DEFAULT 'weekly',
    stage_reminders_enabled boolean NOT NULL DEFAULT true,
    CONSTRAINT automation_settings_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT automation_settings_org_id_unique UNIQUE (org_id),
    CONSTRAINT automation_settings_expire_nudge_lead_days_range
      CHECK (expire_nudge_lead_days >= 1 AND expire_nudge_lead_days <= 30),
    CONSTRAINT automation_settings_followup_threshold_days_range
      CHECK (followup_threshold_days >= 1 AND followup_threshold_days <= 90),
    CONSTRAINT automation_settings_digest_cadence_valid
      CHECK (digest_cadence IN ('daily', 'weekly')),
    CONSTRAINT automation_settings_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  -- 3) automation_run_log (append-only idempotency claim).
  CREATE TABLE IF NOT EXISTS public.automation_run_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    automation_key text NOT NULL,
    period_key text NOT NULL,
    CONSTRAINT automation_run_log_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT automation_run_log_org_key_period_unique
      UNIQUE (org_id, automation_key, period_key),
    CONSTRAINT automation_run_log_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS automation_run_log_org_created_idx
    ON public.automation_run_log (org_id, created_at);

  -- 4) Backfill one default automation_settings row per existing org.
  INSERT INTO public.automation_settings (org_id)
  SELECT o.id
  FROM public.organizations o
  ON CONFLICT (org_id) DO NOTHING;
END $$;
