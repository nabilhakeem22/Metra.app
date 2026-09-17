-- 0053 — the catalogue is made to match `src/schema/`. SCHEMA ONLY: sixteen
-- renames and ten missing indexes. No column, no data, no referential action, no
-- apply-rls object referenced, no enum label named.
--
-- TWO DEFECTS, ONE FILE, because they are the same defect seen from two sides:
-- what the schema DECLARES and what the database HOLDS had never been compared,
-- so nobody noticed either until `assert-schema-applied` was built in wave 6.
--
-- (a) SIXTEEN NAMES DIFFER. Fourteen differ only in CASE: 0017, 0034 and 0046
--     wrote camelCase identifiers UNQUOTED, and Postgres folds an unquoted
--     identifier to lower case — in production AND in every fresh CI database
--     built from these migrations, so this is not a production-only accident and
--     a fresh database is where it can be tested. Two more differ in SPELLING:
--     0041 wrote `boqs_source_file_same_org_fk` and
--     `boq_lines_cost_item_same_org_fk` in snake_case while `sameOrgFk` derives
--     `boqs_sourceFile_same_org_fk` / `boq_lines_costItem_same_org_fk` from the
--     column's camelCase name. A RENAME is the whole fix; DROP + CREATE would be
--     a lock and a rebuild for a label.
--
-- (b) TEN DECLARED INDEXES WERE NEVER CREATED. `sameOrgFk` ships an
--     `(org_id, <x>_id)` index with every composite FK, and 0041 / 0017 / 0015
--     hand-wrote their index lists and left these out. Four carry real work —
--     they are what a delete of the parent scans, and 0052 has just turned those
--     deletes from "always refused" into "happens". The other six are redundant
--     TODAY against a wider index with the same leading columns; each is named
--     with its pair below. They are created anyway, because a catalogue that
--     half-matches the schema teaches everyone to ignore the drift report. The
--     alternative — drop the redundant DECLARATION instead, which is a schema
--     change and a snapshot regenerate rather than a migration — is recorded in
--     the wave report as the better end state.
--
-- WHY THE RENAMES ARE SIXTEEN LITERAL STATEMENTS AND NOT A LOOP OVER A VALUES
-- TABLE. A loop is shorter and was written first. It is also INVISIBLE to a
-- static reader: `EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', …)`
-- carries no identifier a parser can see, so
-- `src/scripts/migration-catalogue.test.ts` — which replays every migration's
-- text and asserts the resulting catalogue contains every name `src/schema/`
-- declares, with no database — would have gone on reporting these sixteen as
-- missing forever. The gate is worth more than the brevity.
--
-- WHY THIS IS SAFE IN ONE TRANSACTION AT TODAY'S SCALE. `CREATE INDEX` (not
-- CONCURRENTLY) takes a SHARE lock: it blocks writers, not readers, while it
-- builds. These ten tables are the small end of the schema — pilot volume is low
-- thousands of rows per org, and production holds six BOQs — so each build is
-- milliseconds. CONCURRENTLY is not available anyway: it cannot run inside a
-- transaction block and `db:migrate` runs every pending migration in ONE. If any
-- of these tables ever reaches the millions, the index half of this file is what
-- moves to a separate `CREATE INDEX CONCURRENTLY` run outside the migrator.
-- `ALTER INDEX / RENAME CONSTRAINT` is catalogue-only: ACCESS EXCLUSIVE, but no
-- scan and no rebuild.
--
-- Idempotent: every rename is guarded on the OLD name existing and the NEW one
-- not, and every create is IF NOT EXISTS. The two assertions at the bottom then
-- refuse to let this file report success on a catalogue that is still adrift, so
-- a mistyped or silently-skipped rename fails the migration rather than leaving
-- the drift exactly where it was. After this runs, `assert-schema-applied` must
-- report 0 NOT FOUND in all four sections.
DO $$
DECLARE
  leftovers text[];
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- ------------------------------------------------- (a) six index names, case
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'contract_lines_costitem_idx') THEN
    ALTER INDEX public.contract_lines_costitem_idx RENAME TO "contract_lines_costItem_idx";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'contracts_sourceproposal_idx') THEN
    ALTER INDEX public.contracts_sourceproposal_idx RENAME TO "contracts_sourceProposal_idx";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'variation_order_events_variationorder_idx') THEN
    ALTER INDEX public.variation_order_events_variationorder_idx
      RENAME TO "variation_order_events_variationOrder_idx";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'variation_order_lines_variationorder_idx') THEN
    ALTER INDEX public.variation_order_lines_variationorder_idx
      RENAME TO "variation_order_lines_variationOrder_idx";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'variation_order_lines_contractline_idx') THEN
    ALTER INDEX public.variation_order_lines_contractline_idx
      RENAME TO "variation_order_lines_contractLine_idx";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
                AND c.relname = 'variation_order_lines_costitem_idx') THEN
    ALTER INDEX public.variation_order_lines_costitem_idx
      RENAME TO "variation_order_lines_costItem_idx";
  END IF;

  -- -------------------------------------------- (a) eight constraint names, case
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'client_payment_claims_confirmedpaymentevent_same_org_fk') THEN
    ALTER TABLE public.client_payment_claims
      RENAME CONSTRAINT client_payment_claims_confirmedpaymentevent_same_org_fk
      TO "client_payment_claims_confirmedPaymentEvent_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'contract_lines_costitem_same_org_fk') THEN
    ALTER TABLE public.contract_lines
      RENAME CONSTRAINT contract_lines_costitem_same_org_fk
      TO "contract_lines_costItem_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'contracts_sourceproposal_same_org_fk') THEN
    ALTER TABLE public.contracts
      RENAME CONSTRAINT contracts_sourceproposal_same_org_fk
      TO "contracts_sourceProposal_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'engagement_change_orders_settledbypaymentevent_same_org_fk') THEN
    ALTER TABLE public.engagement_change_orders
      RENAME CONSTRAINT engagement_change_orders_settledbypaymentevent_same_org_fk
      TO "engagement_change_orders_settledByPaymentEvent_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'variation_order_events_variationorder_same_org_fk') THEN
    ALTER TABLE public.variation_order_events
      RENAME CONSTRAINT variation_order_events_variationorder_same_org_fk
      TO "variation_order_events_variationOrder_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'variation_order_lines_variationorder_same_org_fk') THEN
    ALTER TABLE public.variation_order_lines
      RENAME CONSTRAINT variation_order_lines_variationorder_same_org_fk
      TO "variation_order_lines_variationOrder_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'variation_order_lines_contractline_same_org_fk') THEN
    ALTER TABLE public.variation_order_lines
      RENAME CONSTRAINT variation_order_lines_contractline_same_org_fk
      TO "variation_order_lines_contractLine_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'variation_order_lines_costitem_same_org_fk') THEN
    ALTER TABLE public.variation_order_lines
      RENAME CONSTRAINT variation_order_lines_costitem_same_org_fk
      TO "variation_order_lines_costItem_same_org_fk";
  END IF;

  -- ------------------------------ (a) two constraint names, snake_case vs camel
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'boqs_source_file_same_org_fk') THEN
    ALTER TABLE public.boqs
      RENAME CONSTRAINT boqs_source_file_same_org_fk TO "boqs_sourceFile_same_org_fk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'boq_lines_cost_item_same_org_fk') THEN
    ALTER TABLE public.boq_lines
      RENAME CONSTRAINT boq_lines_cost_item_same_org_fk TO "boq_lines_costItem_same_org_fk";
  END IF;

  -- ------------------------------------------------------- (b) missing indexes
  -- The four that carry real work: what a delete of the parent scans.
  CREATE INDEX IF NOT EXISTS boqs_client_idx ON public.boqs (org_id, client_id);
  CREATE INDEX IF NOT EXISTS boqs_engagement_idx ON public.boqs (org_id, engagement_id);
  CREATE INDEX IF NOT EXISTS "boqs_sourceFile_idx" ON public.boqs (org_id, source_file_id);
  CREATE INDEX IF NOT EXISTS "boq_lines_costItem_idx" ON public.boq_lines (org_id, cost_item_id);

  -- The six the schema declares that a WIDER index already answers today. The
  -- redundant pair is named beside each so nobody has to re-derive it:
  --   boqs_project_idx               == boqs_org_project_idx   (identical columns)
  --   boq_lines_boq_idx              == boq_lines_org_boq_idx  (identical columns)
  --   boq_sections_boq_idx           prefix of boq_sections_org_boq_sort_idx
  --   boq_lines_section_idx          prefix of boq_lines_org_section_sort_idx
  --   contract_sections_contract_idx prefix of contract_sections_org_contract_sort_idx
  --   project_stages_project_idx     prefix of project_stages_org_project_sort_idx
  CREATE INDEX IF NOT EXISTS boqs_project_idx ON public.boqs (org_id, project_id);
  CREATE INDEX IF NOT EXISTS boq_sections_boq_idx ON public.boq_sections (org_id, boq_id);
  CREATE INDEX IF NOT EXISTS boq_lines_boq_idx ON public.boq_lines (org_id, boq_id);
  CREATE INDEX IF NOT EXISTS boq_lines_section_idx ON public.boq_lines (org_id, section_id);
  CREATE INDEX IF NOT EXISTS contract_sections_contract_idx
    ON public.contract_sections (org_id, contract_id);
  CREATE INDEX IF NOT EXISTS project_stages_project_idx
    ON public.project_stages (org_id, project_id);

  -- ------------------------------------------------------------ (c) assertions
  -- Not one of the sixteen old names may survive. A rename that silently did
  -- nothing would otherwise leave the drift where it was and this file would
  -- still report success.
  SELECT coalesce(array_agg(name), '{}'::text[]) INTO leftovers
    FROM (VALUES
      ('contract_lines_costitem_idx'),
      ('contracts_sourceproposal_idx'),
      ('variation_order_events_variationorder_idx'),
      ('variation_order_lines_variationorder_idx'),
      ('variation_order_lines_contractline_idx'),
      ('variation_order_lines_costitem_idx')
    ) AS t(name)
   WHERE EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = t.name
   );
  IF cardinality(leftovers) > 0 THEN
    RAISE EXCEPTION '0053: index name(s) not renamed: %', array_to_string(leftovers, ', ');
  END IF;

  SELECT coalesce(array_agg(name), '{}'::text[]) INTO leftovers
    FROM (VALUES
      ('client_payment_claims_confirmedpaymentevent_same_org_fk'),
      ('contract_lines_costitem_same_org_fk'),
      ('contracts_sourceproposal_same_org_fk'),
      ('engagement_change_orders_settledbypaymentevent_same_org_fk'),
      ('variation_order_events_variationorder_same_org_fk'),
      ('variation_order_lines_variationorder_same_org_fk'),
      ('variation_order_lines_contractline_same_org_fk'),
      ('variation_order_lines_costitem_same_org_fk'),
      ('boqs_source_file_same_org_fk'),
      ('boq_lines_cost_item_same_org_fk')
    ) AS t(name)
   WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t.name);
  IF cardinality(leftovers) > 0 THEN
    RAISE EXCEPTION '0053: constraint name(s) not renamed: %', array_to_string(leftovers, ', ');
  END IF;
END $$;
