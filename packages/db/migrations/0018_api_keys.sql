-- 0018 — Public API keys (v1). SCHEMA ONLY: table, FK, uniques, index. Row-level
-- security, role grants and the app_api_key_by_hash SECURITY DEFINER resolver
-- live EXCLUSIVELY in rls/policies.sql, rls/roles.sql and rls/functions.sql — so
-- the fresh-DB CI replay (migrate -> apply-rls) stays correct. This migration
-- references NO apply-rls object (no metra_app, no app_* function, no policy).
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TABLE IF NOT EXISTS public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    label text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    created_by uuid NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    expires_at timestamptz,
    CONSTRAINT api_keys_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT api_keys_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT api_keys_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  CREATE INDEX IF NOT EXISTS api_keys_token_hash_idx
    ON public.api_keys (token_hash);
END $$;
