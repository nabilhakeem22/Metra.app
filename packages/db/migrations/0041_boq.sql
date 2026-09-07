-- 0041 — Bill of Quantities as structured data (execution phase, slice 1).
--
-- Three tables shaped like contracts/contract_sections/contract_lines, because a
-- BOQ becomes an execution contract and the deep copy should be a straight
-- mapping rather than a translation.
--
-- The BOQ PRICES THE WORKS AND NOTHING ELSE: no tax_rate, no supervision_pct.
-- Those are added when the contract is generated, which is why `total` here is
-- simply `subtotal - discount_amount` rather than the eight-figure chain a
-- proposal carries.
--
-- EVERY BOQ HAS LINES. A studio types them, pulls them from the price book, or
-- fills the downloaded template and uploads it — but an uploaded sheet is an
-- input method, not a second kind of BOQ. `source` records which, and
-- `source_file_id` keeps the sheet attached for provenance; NOTHING downstream is
-- permitted to branch on either, so remeasurement can never acquire a second,
-- untrackable code path.
--
-- boq_lines carries two columns contract_lines has no use for:
--   item_code   — the studio's own reference ("2.03"), free text, never parsed.
--   provisional — an ESTIMATE rather than a count. It decides whether a variance
--                 found on site is routine remeasurement or a scope change that
--                 needs a change order. Defaults false: in fit-out most
--                 quantities are known and marking the few that are not should be
--                 a deliberate act.
--
-- SCHEMA ONLY. No backfill: there is nothing to migrate — production has six BOQ
-- files and zero engagements at the BOQ stage. Row-level security and grants live
-- EXCLUSIVELY in rls/policies.sql + rls/roles.sql.
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boq_status') THEN
    CREATE TYPE public.boq_status AS ENUM ('draft', 'issued', 'superseded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boq_source') THEN
    CREATE TYPE public.boq_source AS ENUM ('built', 'imported');
  END IF;

  CREATE TABLE IF NOT EXISTS public.boqs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    number integer NOT NULL,
    title_ar text,
    title_en text,
    client_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_id uuid,
    status public.boq_status DEFAULT 'draft' NOT NULL,
    source public.boq_source DEFAULT 'built' NOT NULL,
    source_file_id uuid,
    currency text DEFAULT 'EGP' NOT NULL,
    issue_date date,
    version integer DEFAULT 1 NOT NULL,
    supersedes_id uuid,
    notes_ar text,
    notes_en text,
    discount_pct numeric(18, 4) DEFAULT '0' NOT NULL,
    subtotal numeric(18, 4) DEFAULT '0' NOT NULL,
    discount_amount numeric(18, 4) DEFAULT '0' NOT NULL,
    total numeric(18, 4) DEFAULT '0' NOT NULL,
    total_cost numeric(18, 4) DEFAULT '0' NOT NULL,
    total_margin numeric(18, 4) DEFAULT '0' NOT NULL,
    CONSTRAINT boqs_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT boqs_org_id_number_unique UNIQUE (org_id, number),
    CONSTRAINT boqs_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT boqs_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  CREATE TABLE IF NOT EXISTS public.boq_sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    boq_id uuid NOT NULL,
    title_ar text,
    title_en text,
    sort_order integer DEFAULT 0 NOT NULL,
    section_subtotal numeric(18, 4) DEFAULT '0' NOT NULL,
    CONSTRAINT boq_sections_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT boq_sections_title_present CHECK (
      length(regexp_replace(coalesce(title_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(title_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT boq_sections_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  CREATE TABLE IF NOT EXISTS public.boq_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    boq_id uuid NOT NULL,
    section_id uuid NOT NULL,
    cost_item_id uuid,
    item_code text,
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
    provisional boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT boq_lines_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT boq_lines_description_present CHECK (
      length(regexp_replace(coalesce(description_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(description_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT boq_lines_discount_pct_range
      CHECK (discount_pct >= 0 AND discount_pct <= 100),
    CONSTRAINT boq_lines_qty_non_negative CHECK (qty >= 0),
    CONSTRAINT boq_lines_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );

  -- Same-org composite FKs, matching every other cross-table reference.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boqs_client_same_org_fk') THEN
    ALTER TABLE public.boqs ADD CONSTRAINT boqs_client_same_org_fk
      FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE restrict;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boqs_project_same_org_fk') THEN
    ALTER TABLE public.boqs ADD CONSTRAINT boqs_project_same_org_fk
      FOREIGN KEY (org_id, project_id) REFERENCES public.projects (org_id, id) ON DELETE restrict;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boqs_engagement_same_org_fk') THEN
    ALTER TABLE public.boqs ADD CONSTRAINT boqs_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boqs_source_file_same_org_fk') THEN
    ALTER TABLE public.boqs ADD CONSTRAINT boqs_source_file_same_org_fk
      FOREIGN KEY (org_id, source_file_id) REFERENCES public.files (org_id, id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boq_sections_boq_same_org_fk') THEN
    ALTER TABLE public.boq_sections ADD CONSTRAINT boq_sections_boq_same_org_fk
      FOREIGN KEY (org_id, boq_id) REFERENCES public.boqs (org_id, id) ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boq_lines_boq_same_org_fk') THEN
    ALTER TABLE public.boq_lines ADD CONSTRAINT boq_lines_boq_same_org_fk
      FOREIGN KEY (org_id, boq_id) REFERENCES public.boqs (org_id, id) ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boq_lines_section_same_org_fk') THEN
    ALTER TABLE public.boq_lines ADD CONSTRAINT boq_lines_section_same_org_fk
      FOREIGN KEY (org_id, section_id) REFERENCES public.boq_sections (org_id, id) ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boq_lines_cost_item_same_org_fk') THEN
    ALTER TABLE public.boq_lines ADD CONSTRAINT boq_lines_cost_item_same_org_fk
      FOREIGN KEY (org_id, cost_item_id) REFERENCES public.cost_items (org_id, id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS boqs_org_project_idx ON public.boqs (org_id, project_id);
  CREATE INDEX IF NOT EXISTS boqs_org_status_idx ON public.boqs (org_id, status);
  CREATE INDEX IF NOT EXISTS boq_sections_org_boq_sort_idx
    ON public.boq_sections (org_id, boq_id, sort_order);
  CREATE INDEX IF NOT EXISTS boq_lines_org_section_sort_idx
    ON public.boq_lines (org_id, section_id, sort_order);
  CREATE INDEX IF NOT EXISTS boq_lines_org_boq_idx ON public.boq_lines (org_id, boq_id);
END $$;
