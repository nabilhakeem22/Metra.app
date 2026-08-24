-- 0029 — Accounts (Epic A, A1). SCHEMA + DATA BACKFILL ONLY: the accounts table,
-- the nullable organizations.account_id FK + index, and the 1:1 backfill giving
-- every existing organization its OWN distinct account (mirroring the org's name).
-- Row-level security, role privileges and the account-bootstrap function live
-- EXCLUSIVELY in the apply-rls sources (policies / roles / functions) — so the
-- fresh-DB CI replay stays correct. This migration references NO apply-rls object:
-- no request role, no security-definer function, no policy, no privilege change.
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
DECLARE
  r record;
  new_account_id uuid;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- 1) accounts: the billing/ownership entity ABOVE tenancy (NO org_id).
  CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    name_ar text,
    name_en text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT accounts_name_present CHECK (
      length(regexp_replace(coalesce(name_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(name_en, ''), '[[:space:]]', '', 'g')) > 0
    )
  );

  -- 2) organizations.account_id: nullable FK to accounts, on delete restrict.
  ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS account_id uuid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_account_id_accounts_id_fk'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_account_id_accounts_id_fk
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE restrict;
  END IF;

  -- UNIQUE partial index: DB-enforces the 1:1 org<->account invariant (no two orgs
  -- share an account). Partial (WHERE account_id IS NOT NULL) so the nullable A1
  -- additive window is unconstrained on NULLs. Name matches the drizzle schema.
  CREATE UNIQUE INDEX IF NOT EXISTS organizations_account_id_idx
    ON public.organizations (account_id)
    WHERE account_id IS NOT NULL;

  -- 3) 1:1 backfill: every org with no account yet gets its OWN distinct account,
  -- mirroring the org's bilingual name into the account. Re-runnable — only orgs
  -- still missing an account are touched, so a second migrate mints nothing new.
  FOR r IN
    SELECT id, name_ar, name_en FROM public.organizations WHERE account_id IS NULL
  LOOP
    INSERT INTO public.accounts (id, name_ar, name_en)
      VALUES (gen_random_uuid(), r.name_ar, r.name_en)
      RETURNING id INTO new_account_id;
    UPDATE public.organizations
      SET account_id = new_account_id, updated_at = now()
      WHERE id = r.id;
  END LOOP;
END $$;
