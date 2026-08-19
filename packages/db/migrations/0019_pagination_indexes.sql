-- 0019 — Public API (v1) keyset-pagination covering indexes. SCHEMA ONLY: indexes
-- only. The API list endpoints order by (created_at DESC, id DESC) within an org;
-- without a matching index Postgres sorts the whole org partition per page. These
-- (org_id, created_at DESC, id DESC) indexes let the keyset scan read rows already
-- ordered (no Sort node). References NO apply-rls object (no metra_app, no app_*
-- function, no policy). Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE INDEX IF NOT EXISTS clients_org_created_id_idx
    ON public.clients (org_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS projects_org_created_id_idx
    ON public.projects (org_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS cost_items_org_created_id_idx
    ON public.cost_items (org_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS proposals_org_created_id_idx
    ON public.proposals (org_id, created_at DESC, id DESC);
END $$;
