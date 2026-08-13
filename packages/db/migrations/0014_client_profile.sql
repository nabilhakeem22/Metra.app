-- 0014 — Client tabbed profile: client type + commercial fields + advance/
-- retention, plus client_contacts and the polymorphic activities feed. Backfills
-- exactly one primary contact per client that already had a flat contact, with a
-- GUARD that RAISE EXCEPTIONs (rolling back) on any mismatch. One PL/pgSQL block,
-- short lock_timeout, idempotent.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- 1) Enums (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_type') THEN
    CREATE TYPE public.client_type AS ENUM ('individual', 'company', 'consultant');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_entity_type') THEN
    CREATE TYPE public.activity_entity_type AS ENUM ('client', 'project');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_kind') THEN
    CREATE TYPE public.activity_kind AS ENUM ('note', 'client_created', 'proposal_sent', 'proposal_accepted');
  END IF;

  -- 2) clients columns.
  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS type public.client_type NOT NULL DEFAULT 'company';
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS commercial_register text;
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_card_number text;
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS national_id text;
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS segment text;
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lead_source text;
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS credit_terms text;
  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS advance_pct numeric(18, 4) NOT NULL DEFAULT '0';
  ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS retention_pct numeric(18, 4) NOT NULL DEFAULT '0';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_advance_pct_range') THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_advance_pct_range CHECK (advance_pct >= 0 AND advance_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_retention_pct_range') THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_retention_pct_range CHECK (retention_pct >= 0 AND retention_pct <= 100);
  END IF;

  -- 3) client_contacts.
  CREATE TABLE IF NOT EXISTS public.client_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    role text,
    phone text,
    email text,
    whatsapp text,
    is_primary boolean DEFAULT false NOT NULL,
    CONSTRAINT client_contacts_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT client_contacts_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT client_contacts_client_same_org_fk
      FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE cascade
  );
  CREATE UNIQUE INDEX IF NOT EXISTS client_contacts_one_primary
    ON public.client_contacts (org_id, client_id) WHERE is_primary;
  CREATE INDEX IF NOT EXISTS client_contacts_org_client_idx
    ON public.client_contacts (org_id, client_id);
  CREATE INDEX IF NOT EXISTS client_contacts_client_idx
    ON public.client_contacts (org_id, client_id);

  -- RLS (enable + FORCE + org_isolation + grants) is applied by db:apply-rls
  -- (rls/policies.sql + rls/roles.sql), not inline — the policy references
  -- app_is_current_org_member() and the metra_app role, which apply-rls creates
  -- AFTER migrate, so inlining them made a fresh migrate fail.

  -- 4) activities (polymorphic; NO composite FK to the subject).
  CREATE TABLE IF NOT EXISTS public.activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    entity_type public.activity_entity_type NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid,
    kind public.activity_kind NOT NULL DEFAULT 'note',
    note text,
    meta jsonb,
    CONSTRAINT activities_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT activities_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS activities_org_entity_idx
    ON public.activities (org_id, entity_type, entity_id, created_at);

  -- RLS + grants applied by db:apply-rls (see note above), not inline.

  -- 5) Backfill: one primary contact per client that already had a flat contact
  --    and has no primary contact yet.
  INSERT INTO public.client_contacts (org_id, client_id, name, phone, email, is_primary)
  SELECT
    c.org_id,
    c.id,
    coalesce(nullif(trim(c.contact_name), ''), nullif(trim(c.email), ''), nullif(trim(c.phone), ''), 'Contact'),
    c.phone,
    c.email,
    true
  FROM public.clients c
  WHERE (
      nullif(trim(c.contact_name), '') IS NOT NULL
      OR nullif(trim(c.email), '') IS NOT NULL
      OR nullif(trim(c.phone), '') IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.client_contacts cc
      WHERE cc.org_id = c.org_id AND cc.client_id = c.id AND cc.is_primary
    );

  -- 6) GUARD: every client with a flat contact must have EXACTLY one primary.
  IF EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE (
        nullif(trim(c.contact_name), '') IS NOT NULL
        OR nullif(trim(c.email), '') IS NOT NULL
        OR nullif(trim(c.phone), '') IS NOT NULL
      )
      AND (
        SELECT count(*) FROM public.client_contacts cc
        WHERE cc.org_id = c.org_id AND cc.client_id = c.id AND cc.is_primary
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'migration 0014 aborted: a client with a flat contact does not have exactly one primary contact';
  END IF;
END $$;
