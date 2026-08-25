-- 0030 — Per-workspace entitlements (Epic A2) + accounts.plan_key. SCHEMA + DATA
-- BACKFILL ONLY: the workspace_entitlements table (one row per workspace, 1:1 via
-- unique(org_id)), the accounts.plan_key billing column, and the re-runnable
-- backfill giving every existing organization an `{interior}` entitlement row.
-- Row-level security, role privileges, the workspace-isolation rule and the
-- account_id immutability check live EXCLUSIVELY in the apply-rls sources
-- (policies / roles / immutability) — so the fresh-DB CI replay (migrate ->
-- apply-rls) stays correct. This migration references NO apply-rls object: no
-- request role, no security-definer function, no isolation rule, no privilege
-- change, no row trigger. Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- 1) workspace_entitlements: the per-workspace flow/limit/feature entitlement.
  -- Exactly one row per workspace (unique(org_id)); composite unique(org_id, id) keeps
  -- it eligible as a same-org FK target if ever referenced. org_id FK is on delete
  -- restrict (mirrors every other org-scoped table).
  CREATE TABLE IF NOT EXISTS public.workspace_entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    enabled_flows text[] NOT NULL DEFAULT '{}',
    limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    features jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT workspace_entitlements_org_id_unique UNIQUE (org_id),
    CONSTRAINT workspace_entitlements_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT workspace_entitlements_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  -- 2) accounts.plan_key: billing-only subscription plan name (A2). NOT used to
  -- derive per-workspace limits — those live in workspace_entitlements.
  ALTER TABLE public.accounts
    ADD COLUMN IF NOT EXISTS plan_key text NOT NULL DEFAULT 'standard';

  -- 3) Backfill (re-runnable): every workspace that has no entitlement row yet
  -- gets `{interior}` enabled. A second migrate inserts nothing new.
  INSERT INTO public.workspace_entitlements (org_id, enabled_flows)
  SELECT o.id, '{interior}'
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workspace_entitlements w WHERE w.org_id = o.id
  );
END $$;
