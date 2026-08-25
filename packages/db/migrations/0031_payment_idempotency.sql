-- 0031 — Payment idempotency hardening (Design-Engagement Machine). SCHEMA ONLY:
-- one nullable column + one partial UNIQUE index that makes a client-supplied
-- idempotency key the append-only dedup arbiter, scoped to
-- (org_id, engagement_id, idempotency_key). Additive/back-compat: existing rows
-- keep a NULL key and are excluded from the partial index (no collisions on
-- populated prod). The request-role privileges stay unchanged (SELECT + INSERT
-- only) — append-only is preserved via ON CONFLICT DO NOTHING at the app layer,
-- never an upsert. Row-level security and role privileges live EXCLUSIVELY in the
-- apply-rls sources. This migration references NO apply-rls object. Idempotent,
-- one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.payment_events
    ADD COLUMN IF NOT EXISTS idempotency_key text;

  -- Partial UNIQUE index = the dedup arbiter. Only rows WITH a key participate,
  -- so legacy/keyless payments (idempotency_key IS NULL) never collide.
  CREATE UNIQUE INDEX IF NOT EXISTS payment_events_idempotency_key_uniq
    ON public.payment_events (org_id, engagement_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
END $$;
