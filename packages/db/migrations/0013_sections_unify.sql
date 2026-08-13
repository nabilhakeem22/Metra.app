-- 0013 — unify Price Book categories + proposal section library into a single
-- per-tenant `sections` table. Fail-safe + ordered: backfill cost_items.section_id,
-- GUARD (raise if any NULL), and only THEN drop the category column + enum type.
-- Runs as one PL/pgSQL block (atomic within the migrator's transaction) with a
-- short lock_timeout so it can never wedge on a busy table.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- 1) sections table (+ constraints/indexes).
  CREATE TABLE IF NOT EXISTS public.sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    key text,
    name_ar text,
    name_en text,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT sections_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT sections_name_present CHECK (
      length(regexp_replace(coalesce(name_ar, ''), '[[:space:]]', '', 'g')) > 0
      OR length(regexp_replace(coalesce(name_en, ''), '[[:space:]]', '', 'g')) > 0
    ),
    CONSTRAINT sections_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sections_org_key_unique
    ON public.sections (org_id, key) WHERE key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS sections_org_active_idx
    ON public.sections (org_id, active);

  -- 2) RLS (enable + FORCE + org_isolation + grants) is applied by db:apply-rls
  --    (rls/policies.sql + rls/roles.sql), NOT here: the org_isolation policy
  --    references app_is_current_org_member() and the metra_app role, which
  --    apply-rls creates AFTER migrate. Inlining them made a fresh migrate fail
  --    (function/role absent). Migrations create schema; apply-rls owns RLS.

  -- 3) Seed the 8 defaults for every existing org (idempotent).
  INSERT INTO public.sections (org_id, key, name_en, name_ar)
  SELECT o.id, d.key, d.name_en, d.name_ar
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('civil', 'Civil', 'أعمال مدنية'),
    ('gypsum', 'Gypsum', 'جبس'),
    ('electrical', 'Electrical', 'كهرباء'),
    ('plumbing', 'Plumbing', 'سباكة'),
    ('joinery', 'Joinery', 'نجارة'),
    ('finishes', 'Finishes', 'تشطيبات'),
    ('furniture', 'Furniture', 'أثاث'),
    ('preliminaries', 'Preliminaries', 'أعمال تمهيدية')
  ) AS d(key, name_en, name_ar)
  ON CONFLICT (org_id, key) WHERE key IS NOT NULL DO NOTHING;

  -- 4) cost_items.section_id (nullable first).
  ALTER TABLE public.cost_items ADD COLUMN IF NOT EXISTS section_id uuid;

  -- 5) Backfill by matching the old category key within the same org.
  UPDATE public.cost_items c
  SET section_id = s.id
  FROM public.sections s
  WHERE s.org_id = c.org_id AND s.key = c.category::text;

  -- 6) GUARD: refuse to proceed (and roll back) if any item is unmapped.
  IF EXISTS (SELECT 1 FROM public.cost_items WHERE section_id IS NULL) THEN
    RAISE EXCEPTION 'migration 0013 aborted: % cost_items have NULL section_id after backfill',
      (SELECT count(*) FROM public.cost_items WHERE section_id IS NULL);
  END IF;

  -- 7) Now the mapping is proven complete: composite same-org FK, index, NOT NULL.
  ALTER TABLE public.cost_items
    ADD CONSTRAINT cost_items_section_same_org_fk
    FOREIGN KEY (org_id, section_id) REFERENCES public.sections (org_id, id) ON DELETE restrict;
  CREATE INDEX IF NOT EXISTS cost_items_section_idx
    ON public.cost_items (org_id, section_id);
  ALTER TABLE public.cost_items ALTER COLUMN section_id SET NOT NULL;

  -- 8) Retire the old category column + its index.
  DROP INDEX IF EXISTS public.cost_items_org_category_idx;
  ALTER TABLE public.cost_items DROP COLUMN category;

  -- 9) price_changes.category becomes a frozen text snapshot.
  ALTER TABLE public.price_changes ALTER COLUMN category TYPE text USING category::text;

  -- 10) Migrate any proposal_section_library rows into sections (key NULL,
  --     dedup by case-insensitive name in either language), then drop the table.
  INSERT INTO public.sections (org_id, key, name_en, name_ar, active)
  SELECT l.org_id, NULL, l.name_en, l.name_ar, l.active
  FROM public.proposal_section_library l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.org_id = l.org_id
      AND (
        (s.name_en IS NOT NULL AND l.name_en IS NOT NULL AND lower(s.name_en) = lower(l.name_en))
        OR (s.name_ar IS NOT NULL AND l.name_ar IS NOT NULL AND lower(s.name_ar) = lower(l.name_ar))
      )
  );
  DROP TABLE IF EXISTS public.proposal_section_library;

  -- 11) Drop the now-unreferenced enum type.
  DROP TYPE IF EXISTS public.cost_item_category;
END $$;
