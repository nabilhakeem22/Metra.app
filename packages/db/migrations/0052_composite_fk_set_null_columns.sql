-- 0052 — the eleven composite `ON DELETE SET NULL` foreign keys learn WHICH
-- column to null. SCHEMA ONLY: no column added, no data touched, no apply-rls
-- object referenced, no enum label named.
--
-- THE DEFECT. `sameOrgFk` (src/schema/org-ref.ts) emits the composite tenancy
-- FK `(org_id, <x>_id) -> parent(org_id, id)`, which is what makes a cross-org
-- reference impossible at the database. Eleven of those are declared
-- `on delete set null`. PostgreSQL's `ON DELETE SET NULL` **with no column
-- list nulls EVERY referencing column** — `org_id` included, and `org_id` is
-- `not null` on every org-scoped table. So the referential action produces a
-- row the table cannot hold and the PARENT DELETE IS REFUSED, always:
--   * 23502 (not_null_violation) on an ordinary child row;
--   * MT100 on a child row under `enforce_immutable_when`, only because a
--     BEFORE trigger runs before the not-null check and sees org_id change.
-- Measured, with the catalogue read, in tests/actions/boq-immutable.dbtest.ts.
--
-- WHAT THAT COSTS TODAY. Deleting a document (`lib/documents/core.ts`) reaches
-- `boqs_source_file_same_org_fk`; the compensating delete after a failed
-- Supabase upload (`lib/storage/*`) reaches the same one. The day the importer
-- writes `boqs.source_file_id`, that spreadsheet becomes permanently
-- undeletable and the studio sees a generic failure with no recovery. Deleting
-- a price-book cost item — an obvious next catalogue feature — lands on four of
-- the eleven at once. `purge-fixture-orgs-tables.ts` survives only because its
-- delete order happens to be child-first today.
--
-- THE FIX, available since PostgreSQL 15 and therefore on Supabase (17) and on
-- CI (postgres:17): `ON DELETE SET NULL (<x>_id)`. The referential action then
-- nulls the reference and LEAVES `org_id` ALONE, which is the behaviour the
-- schema always meant.
--
-- DRIZZLE CANNOT SAY THIS. `foreignKey().onDelete()` in drizzle-orm 0.36 takes
-- an action and no column list, and the snapshot format (v7) has no field for
-- one. So `src/schema/org-ref.ts` keeps emitting a bare `'set null'` — it is
-- documented there — and `db:assert-snapshot` stays green because the schema
-- and the snapshot still agree on the ACTION. The column list lives here, in
-- the database, from this migration onward. Nothing in the repo can assert the
-- narrowing survived a future `drizzle-kit generate`; the straggler check at the
-- bottom of this file is the closest thing, and it runs once, here.
--
-- THE NAMES ARE THE PROD/CI CATALOGUE SPELLINGS, NOT THE SCHEMA'S. Six of these
-- eleven were written UNQUOTED in camelCase by 0017 / 0034 / 0046 and Postgres
-- folded them to lower case; two more (`boqs_source_file_same_org_fk`,
-- `boq_lines_cost_item_same_org_fk`) were written in snake_case by 0041 while
-- the schema declares camelCase. Every database built from these migrations —
-- production and every fresh CI database alike — holds the spellings in the
-- table below, and `format('%I', …)` quotes each one exactly as it is. The
-- reconciliation of those names with `src/schema/` is 0053's job, deliberately
-- separate: this file changes referential ACTIONS and nothing else, and it
-- RAISES rather than skips if a name is not found, so a mistyped constraint
-- fails the migration instead of silently leaving the FK unnarrowed.
--
-- LOCKS, stated plainly. `db:migrate` runs every pending migration in ONE
-- transaction (src/scripts/migrate.ts), so the first `DROP CONSTRAINT`'s ACCESS
-- EXCLUSIVE is held until the whole batch commits — across nine child tables
-- and seven parents, sixteen tables in all. `NOT VALID` + `VALIDATE` is the
-- house convention (0044, 0051) and is kept here for the same reasons: either
-- half is independently idempotent, the scan is a separate named statement, and
-- the file reads as the steps it is. It does NOT shorten the hold on this run —
-- VALIDATE's weaker SHARE UPDATE EXCLUSIVE cannot downgrade a lock already
-- held. At pilot volume (low thousands of rows per org across all nine
-- children) the scans are milliseconds; the convention is what keeps that true
-- at 10^6, where the two halves would be split across two merges instead.
--
-- Idempotent: a constraint that already carries a set-null column list is
-- counted and skipped, so a re-run is a no-op.
DO $$
DECLARE
  fk           record;
  narrowed     integer := 0;
  already_narrow integer := 0;
  stragglers   integer;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  FOR fk IN
    SELECT *
      FROM (VALUES
        -- child table,               constraint name AS THE CATALOGUE HOLDS IT,                     child column,                    parent table
        ('boqs',                      'boqs_engagement_same_org_fk',                                 'engagement_id',                 'design_engagements'),
        ('boqs',                      'boqs_source_file_same_org_fk',                                 'source_file_id',                'files'),
        ('boq_lines',                 'boq_lines_cost_item_same_org_fk',                              'cost_item_id',                  'cost_items'),
        ('contract_lines',            'contract_lines_costitem_same_org_fk',                          'cost_item_id',                  'cost_items'),
        ('proposal_lines',            'proposal_lines_costItem_same_org_fk',                          'cost_item_id',                  'cost_items'),
        ('variation_order_lines',     'variation_order_lines_costitem_same_org_fk',                   'cost_item_id',                  'cost_items'),
        ('variation_order_lines',     'variation_order_lines_contractline_same_org_fk',               'contract_line_id',              'contract_lines'),
        ('projects',                  'projects_type_same_org_fk',                                    'type_id',                       'project_types'),
        ('proposals',                 'proposals_supersedes_same_org_fk',                             'supersedes_id',                 'proposals'),
        ('client_payment_claims',     'client_payment_claims_confirmedpaymentevent_same_org_fk',      'confirmed_payment_event_id',    'payment_events'),
        ('engagement_change_orders',  'engagement_change_orders_settledbypaymentevent_same_org_fk',   'settled_by_payment_event_id',   'payment_events')
      ) AS t(child, conname, child_col, parent)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conname = fk.conname
         AND c.conrelid = format('public.%I', fk.child)::regclass
         AND c.contype = 'f'
    ) THEN
      RAISE EXCEPTION
        '0052: public.% has no foreign key named "%" — look the name up in pg_constraint before editing this list, do not type it',
        fk.child, fk.conname;
    END IF;

    -- Already carries a column list (a re-run, or a hand-applied fix).
    IF EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conname = fk.conname
         AND c.conrelid = format('public.%I', fk.child)::regclass
         AND c.contype = 'f'
         AND c.confdeltype = 'n'
         AND coalesce(array_length(c.confdelsetcols, 1), 0) > 0
    ) THEN
      already_narrow := already_narrow + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', fk.child, fk.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id, %I) '
      'REFERENCES public.%I (org_id, id) ON DELETE SET NULL (%I) NOT VALID',
      fk.child, fk.conname, fk.child_col, fk.parent, fk.child_col
    );
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', fk.child, fk.conname);
    narrowed := narrowed + 1;
  END LOOP;

  -- THE STRAGGLER CHECK. After this file, NO composite foreign key in `public`
  -- may still carry an unqualified SET NULL, or name `org_id` in its column
  -- list. This is what makes the eleven-row list above an assertion rather than
  -- a hope: a twelfth such FK added between the wave-6 survey and this run
  -- fails the migration here instead of shipping the same latent outage. A
  -- SINGLE-column set-null FK is untouched and uncounted — nulling its one
  -- column is correct by construction.
  SELECT count(*) INTO stragglers
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND c.contype = 'f'
     AND c.confdeltype = 'n'
     AND array_length(c.conkey, 1) > 1
     AND (
       coalesce(array_length(c.confdelsetcols, 1), 0) <> 1
       OR (
         SELECT a.attname
           FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = c.confdelsetcols[1]
       ) = 'org_id'
     );

  IF stragglers > 0 THEN
    RAISE EXCEPTION
      '0052: % composite set-null foreign key(s) still null every referencing column (org_id included). Add them to the list in this file.',
      stragglers;
  END IF;

  RAISE NOTICE '0052: % composite set-null FK(s) narrowed, % already narrow', narrowed, already_narrow;
END $$;
