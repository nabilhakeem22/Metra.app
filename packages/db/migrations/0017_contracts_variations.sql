-- 0017 — Contracts + Variation Orders (P1 Slice 4). SCHEMA ONLY: enums, tables,
-- FKs, indexes, CHECKs. Row-level security, grants, immutability + child-draft
-- triggers and the public token SDFs live EXCLUSIVELY in rls/policies.sql,
-- rls/roles.sql and rls/functions.sql — so the fresh-DB CI replay
-- (migrate -> apply-rls) stays correct. This migration references NO apply-rls
-- object (no metra_app, no app_* function, no policy). Idempotent, one PL/pgSQL
-- block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- contract_status / variation_status enums (guarded — CREATE TYPE has no IF NOT EXISTS).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_status') THEN
    CREATE TYPE public.contract_status AS ENUM ('draft', 'issued', 'signed', 'terminated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'variation_status') THEN
    CREATE TYPE public.variation_status AS ENUM
      ('draft', 'internal_approved', 'issued', 'approved', 'rejected');
  END IF;

  -- 1) contracts (generated from an accepted proposal).
  CREATE TABLE IF NOT EXISTS public.contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    number integer NOT NULL,
    title_ar text,
    title_en text,
    source_proposal_id uuid NOT NULL,
    client_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status public.contract_status DEFAULT 'draft' NOT NULL,
    currency text DEFAULT 'EGP' NOT NULL,
    signature_date date,
    start_date date,
    end_date date,
    retention_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    retention_release_terms_ar text,
    retention_release_terms_en text,
    advance_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    advance_recovery_method text DEFAULT 'prorata' NOT NULL,
    payment_terms_days integer,
    payment_schedule_mode text DEFAULT 'milestone' NOT NULL,
    penalty_ar text,
    penalty_en text,
    defects_liability_days integer,
    scope_inclusions_ar text,
    scope_inclusions_en text,
    scope_exclusions_ar text,
    scope_exclusions_en text,
    terms_ar text,
    terms_en text,
    original_value numeric(18, 4) DEFAULT '0' NOT NULL,
    discount_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    tax_rate numeric(18, 4) DEFAULT '14' NOT NULL,
    supervision_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    subtotal numeric(18, 4) DEFAULT '0' NOT NULL,
    discount_amount numeric(18, 4) DEFAULT '0' NOT NULL,
    taxable_base numeric(18, 4) DEFAULT '0' NOT NULL,
    tax_amount numeric(18, 4) DEFAULT '0' NOT NULL,
    supervision_amount numeric(18, 4) DEFAULT '0' NOT NULL,
    total_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    total_margin numeric(18, 4) DEFAULT '0' NOT NULL,
    token_hash text,
    share_expires_at timestamptz,
    CONSTRAINT contracts_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT contracts_org_id_number_unique UNIQUE (org_id, number),
    CONSTRAINT contracts_org_id_source_proposal_unique UNIQUE (org_id, source_proposal_id),
    CONSTRAINT contracts_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT contracts_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT contracts_end_after_start CHECK (
      end_date IS NULL OR start_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT contracts_retention_pct_range CHECK (retention_pct >= 0 AND retention_pct <= 100),
    CONSTRAINT contracts_advance_pct_range CHECK (advance_pct >= 0 AND advance_pct <= 100),
    CONSTRAINT contracts_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT contracts_sourceProposal_same_org_fk
      FOREIGN KEY (org_id, source_proposal_id) REFERENCES public.proposals (org_id, id) ON DELETE restrict,
    CONSTRAINT contracts_client_same_org_fk
      FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE restrict,
    CONSTRAINT contracts_project_same_org_fk
      FOREIGN KEY (org_id, project_id) REFERENCES public.projects (org_id, id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS contracts_sourceProposal_idx ON public.contracts (org_id, source_proposal_id);
  CREATE INDEX IF NOT EXISTS contracts_client_idx ON public.contracts (org_id, client_id);
  CREATE INDEX IF NOT EXISTS contracts_project_idx ON public.contracts (org_id, project_id);
  CREATE INDEX IF NOT EXISTS contracts_org_status_idx ON public.contracts (org_id, status);
  CREATE INDEX IF NOT EXISTS contracts_org_project_idx ON public.contracts (org_id, project_id);

  -- 2) contract_sections (frozen snapshot of the proposal sections).
  CREATE TABLE IF NOT EXISTS public.contract_sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    contract_id uuid NOT NULL,
    title_ar text,
    title_en text,
    sort_order integer DEFAULT 0 NOT NULL,
    section_subtotal numeric(18, 4) DEFAULT '0' NOT NULL,
    CONSTRAINT contract_sections_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT contract_sections_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT contract_sections_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT contract_sections_contract_same_org_fk
      FOREIGN KEY (org_id, contract_id) REFERENCES public.contracts (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS contract_sections_org_contract_sort_idx
    ON public.contract_sections (org_id, contract_id, sort_order);

  -- 3) contract_lines (frozen baseline lines).
  CREATE TABLE IF NOT EXISTS public.contract_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    contract_id uuid NOT NULL,
    section_id uuid NOT NULL,
    cost_item_id uuid,
    description_ar text,
    description_en text,
    qty numeric(18, 4) NOT NULL,
    unit public.cost_item_unit NOT NULL,
    unit_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    unit_price numeric(18, 4) NOT NULL,
    discount_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    line_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    line_total numeric(18, 4) DEFAULT '0' NOT NULL,
    line_margin numeric(18, 4) DEFAULT '0' NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT contract_lines_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT contract_lines_description_present CHECK (
      length(regexp_replace(coalesce(description_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(description_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT contract_lines_discount_pct_range CHECK (discount_pct >= 0 AND discount_pct <= 100),
    CONSTRAINT contract_lines_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT contract_lines_contract_same_org_fk
      FOREIGN KEY (org_id, contract_id) REFERENCES public.contracts (org_id, id) ON DELETE cascade,
    CONSTRAINT contract_lines_section_same_org_fk
      FOREIGN KEY (org_id, section_id) REFERENCES public.contract_sections (org_id, id) ON DELETE cascade,
    CONSTRAINT contract_lines_costItem_same_org_fk
      FOREIGN KEY (org_id, cost_item_id) REFERENCES public.cost_items (org_id, id) ON DELETE set null
  );
  CREATE INDEX IF NOT EXISTS contract_lines_contract_idx ON public.contract_lines (org_id, contract_id);
  CREATE INDEX IF NOT EXISTS contract_lines_section_idx ON public.contract_lines (org_id, section_id);
  CREATE INDEX IF NOT EXISTS contract_lines_costItem_idx ON public.contract_lines (org_id, cost_item_id);
  CREATE INDEX IF NOT EXISTS contract_lines_org_section_sort_idx
    ON public.contract_lines (org_id, section_id, sort_order);

  -- 4) contract_events (append-only via grants).
  CREATE TABLE IF NOT EXISTS public.contract_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    contract_id uuid NOT NULL,
    kind text NOT NULL,
    actor_user_id uuid,
    actor_name text,
    ip text,
    user_agent text,
    pdf_hash text,
    from_status text,
    to_status text,
    decided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT contract_events_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT contract_events_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT contract_events_contract_same_org_fk
      FOREIGN KEY (org_id, contract_id) REFERENCES public.contracts (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS contract_events_contract_idx ON public.contract_events (org_id, contract_id);

  -- 5) variation_orders (priced change against a contract).
  CREATE TABLE IF NOT EXISTS public.variation_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    number integer NOT NULL,
    contract_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status public.variation_status DEFAULT 'draft' NOT NULL,
    title_ar text,
    title_en text,
    reason_ar text,
    reason_en text,
    net_delta numeric(18, 4) DEFAULT '0' NOT NULL,
    token_hash text,
    share_expires_at timestamptz,
    CONSTRAINT variation_orders_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT variation_orders_org_id_number_unique UNIQUE (org_id, number),
    CONSTRAINT variation_orders_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT variation_orders_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT variation_orders_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT variation_orders_contract_same_org_fk
      FOREIGN KEY (org_id, contract_id) REFERENCES public.contracts (org_id, id) ON DELETE restrict,
    CONSTRAINT variation_orders_project_same_org_fk
      FOREIGN KEY (org_id, project_id) REFERENCES public.projects (org_id, id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS variation_orders_contract_idx ON public.variation_orders (org_id, contract_id);
  CREATE INDEX IF NOT EXISTS variation_orders_project_idx ON public.variation_orders (org_id, project_id);
  CREATE INDEX IF NOT EXISTS variation_orders_org_status_idx ON public.variation_orders (org_id, status);
  CREATE INDEX IF NOT EXISTS variation_orders_org_contract_idx ON public.variation_orders (org_id, contract_id);

  -- 6) variation_order_lines (delta lines; contract_line_id nullable).
  CREATE TABLE IF NOT EXISTS public.variation_order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    variation_order_id uuid NOT NULL,
    contract_line_id uuid,
    cost_item_id uuid,
    description_ar text,
    description_en text,
    qty numeric(18, 4) NOT NULL,
    unit public.cost_item_unit NOT NULL,
    unit_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    unit_price numeric(18, 4) NOT NULL,
    discount_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    line_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    line_total numeric(18, 4) DEFAULT '0' NOT NULL,
    line_margin numeric(18, 4) DEFAULT '0' NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT variation_order_lines_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT variation_order_lines_description_present CHECK (
      length(regexp_replace(coalesce(description_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(description_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT variation_order_lines_discount_pct_range CHECK (discount_pct >= 0 AND discount_pct <= 100),
    CONSTRAINT variation_order_lines_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT variation_order_lines_variationOrder_same_org_fk
      FOREIGN KEY (org_id, variation_order_id) REFERENCES public.variation_orders (org_id, id) ON DELETE cascade,
    CONSTRAINT variation_order_lines_contractLine_same_org_fk
      FOREIGN KEY (org_id, contract_line_id) REFERENCES public.contract_lines (org_id, id) ON DELETE set null,
    CONSTRAINT variation_order_lines_costItem_same_org_fk
      FOREIGN KEY (org_id, cost_item_id) REFERENCES public.cost_items (org_id, id) ON DELETE set null
  );
  CREATE INDEX IF NOT EXISTS variation_order_lines_variationOrder_idx
    ON public.variation_order_lines (org_id, variation_order_id);
  CREATE INDEX IF NOT EXISTS variation_order_lines_contractLine_idx
    ON public.variation_order_lines (org_id, contract_line_id);
  CREATE INDEX IF NOT EXISTS variation_order_lines_costItem_idx
    ON public.variation_order_lines (org_id, cost_item_id);
  CREATE INDEX IF NOT EXISTS variation_order_lines_org_vo_sort_idx
    ON public.variation_order_lines (org_id, variation_order_id, sort_order);

  -- 7) variation_order_events (append-only via grants).
  CREATE TABLE IF NOT EXISTS public.variation_order_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    variation_order_id uuid NOT NULL,
    kind text NOT NULL,
    actor_user_id uuid,
    actor_name text,
    ip text,
    user_agent text,
    from_status text,
    to_status text,
    decided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT variation_order_events_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT variation_order_events_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT variation_order_events_variationOrder_same_org_fk
      FOREIGN KEY (org_id, variation_order_id) REFERENCES public.variation_orders (org_id, id) ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS variation_order_events_variationOrder_idx
    ON public.variation_order_events (org_id, variation_order_id);
END $$;
