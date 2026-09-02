-- 0039 — Project country + code sequence (projects module spec). SCHEMA ONLY, both
-- additive:
--   * `country` — nullable text beside the existing city/address, optional in the
--     form exactly like the client's.
--   * `number` — the per-org integer sequence behind an AUTO-GENERATED project code
--     (P-YYYY-NNNN), allocated by the same `allocateNumber` advisory-lock helper the
--     proposals / contracts / variation-order sequences already use. NULLABLE on
--     purpose: all 307 projects already in production carry a hand-entered `code`
--     and must keep it untouched, so they simply have no sequence number. Only
--     projects created from here on get one.
-- A partial UNIQUE index enforces one sequence number per org over the rows that
-- HAVE one, so the legacy nulls cannot collide with each other.
-- No RLS change: the existing projects org_isolation policy and grants already cover
-- both columns. This migration references NO apply-rls object. Idempotent, one
-- PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS country text,
    ADD COLUMN IF NOT EXISTS number integer;

  CREATE UNIQUE INDEX IF NOT EXISTS projects_org_number_unique
    ON public.projects (org_id, number) WHERE number IS NOT NULL;
END $$;
