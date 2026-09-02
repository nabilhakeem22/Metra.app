-- 0040 — Firm-configurable document categories (clients + projects module spec).
--
-- One org-scoped table plus one nullable column on `files`. The category is the
-- FIRM'S filing vocabulary: each org starts from a default set it can rename,
-- reorder, deactivate or extend. Nothing in the app branches on which category a
-- document is in, which is what makes the vocabulary genuinely theirs.
--
-- BACKFILL, following the 0015 precedent (stage_templates): every org that already
-- exists is seeded with the same defaults createOrgCore gives a new one, so the
-- picker is never empty for anybody. `key` is unique per org, so re-running this is
-- a no-op rather than a duplicate set. The label text is duplicated here from
-- src/schema/document-category-defaults.ts on purpose — a migration must be a frozen
-- historical record and cannot import code that will keep changing.
--
-- `files.category_id` is NULLABLE: every existing file keeps working and simply
-- reads as uncategorised. Its FK is ON DELETE SET NULL so removing a category can
-- never orphan a document — though roles.sql grants no DELETE on the table anyway,
-- since the supported way to retire a category is `active = false`.
--
-- Row-level security and grants live EXCLUSIVELY in rls/policies.sql + rls/roles.sql.
-- Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TABLE IF NOT EXISTS public.document_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    name_en text,
    name_ar text,
    key text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT document_categories_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT document_categories_org_key_unique UNIQUE (org_id, key),
    CONSTRAINT document_categories_name_present
      CHECK (name_en IS NOT NULL OR name_ar IS NOT NULL),
    CONSTRAINT document_categories_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE INDEX IF NOT EXISTS document_categories_org_active_idx
    ON public.document_categories (org_id, active, sort_order);

  ALTER TABLE public.files
    ADD COLUMN IF NOT EXISTS category_id uuid;

  -- Same-org composite FK, matching every other cross-table reference here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_category_same_org_fk'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_category_same_org_fk
      FOREIGN KEY (org_id, category_id)
      REFERENCES public.document_categories (org_id, id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS files_org_category_idx
    ON public.files (org_id, category_id) WHERE category_id IS NOT NULL;

  -- Backfill the default set for every EXISTING org (0015 precedent). ON CONFLICT
  -- on (org_id, key) makes a re-run a no-op.
  INSERT INTO public.document_categories (org_id, key, name_en, name_ar, sort_order)
  SELECT o.id, d.key, d.name_en, d.name_ar, d.sort_order
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('contract',       'Contracts',           'العقود',                    0),
    ('commercial',     'Commercial & tax',    'مستندات تجارية وضريبية',    1),
    ('drawings',       'Drawings',            'الرسومات',                  2),
    ('correspondence', 'Correspondence',      'المراسلات',                 3),
    ('invoices',       'Invoices',            'الفواتير',                  4),
    ('other',          'Other',               'أخرى',                      5)
  ) AS d(key, name_en, name_ar, sort_order)
  ON CONFLICT (org_id, key) DO NOTHING;
END $$;
