-- 0020 — Trim non-MVP fields. Schema-only, destructive: drop client columns that
-- carry regulated/sensitive identifiers and CRM metadata not in the MVP, plus the
-- redundant project contract_ref (superseded by the Contracts module). Idempotent
-- (DROP COLUMN IF EXISTS); no RLS/apply-rls references. Hand-authored (drizzle
-- generate's rename TUI can't run headless) — the snapshot has drifted, so the
-- meta snapshots are NOT regenerated here; verify meta before the next generate.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.clients DROP COLUMN IF EXISTS national_id;
  ALTER TABLE public.clients DROP COLUMN IF EXISTS tax_card_number;
  ALTER TABLE public.clients DROP COLUMN IF EXISTS commercial_register;
  ALTER TABLE public.clients DROP COLUMN IF EXISTS credit_terms;
  ALTER TABLE public.clients DROP COLUMN IF EXISTS segment;
  ALTER TABLE public.clients DROP COLUMN IF EXISTS lead_source;

  ALTER TABLE public.projects DROP COLUMN IF EXISTS contract_ref;
END $$;
