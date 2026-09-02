-- 0038 — Client country (client module spec). SCHEMA ONLY: one nullable text column
-- on clients, alongside the existing city/address. Optional by design — the field is
-- optional in the form, and every existing client predates it. No enum, no index (it
-- is not filtered on; the spec filters by status and city), no RLS change: the
-- existing clients org_isolation policy and its grants already cover this column, so
-- nothing lands in rls/policies.sql or rls/roles.sql. This migration references NO
-- apply-rls object. Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS country text;
END $$;
