-- 0054 — the six redundant indexes 0053 created are dropped again. SCHEMA ONLY:
-- six DROP INDEX and nothing else. No column, no data, no referential action, no
-- constraint, no apply-rls object referenced, no enum label named.
--
-- WHY THEY WERE CREATED AND WHY THEY GO. `sameOrgFk` ships an
-- `(org_id, <x>_id)` index with every composite FK it emits, and 0041 / 0017 /
-- 0015 hand-wrote their index lists and left ten of those out. 0053 created all
-- ten, deliberately including these six, because a catalogue that HALF matches
-- the schema teaches everyone to ignore the drift report — and the drift report
-- is the instrument the whole programme was paying for. That argument held only
-- until the report read zero, which it now does.
--
-- Each of the six is answered TODAY by a wider index with the same leading
-- columns, named beside it below. Two are exact duplicates; four are strict
-- prefixes. A btree index on `(a, b, c)` serves any query that constrains a
-- leading subset — `(a)`, `(a, b)` — so the prefix cases cost a second B-tree to
-- answer nothing the first could not.
--
-- THE COST THEY CARRY IS ON THE WRITE SIDE, AND IT WAS NEVER MEASURED. Three of
-- the six land on `boq_lines`, which is the hot path of a replace-import: every
-- inserted row pays an index entry per index, and wave 6 added roughly 4,300
-- plpgsql trigger calls to the same path. At 53 boq_lines in production this is
-- invisible; at a 2,000-line import it is two unmeasured costs composed. That is
-- the whole case for this file — it is not a tidy-up.
--
-- THE DECLARATIONS GO IN THE SAME COMMIT. `sameOrgFk(..., { index: false })` in
-- boqs.ts, boq-sections.ts, boq-lines.ts (twice), contract-sections.ts and
-- project-stages.ts. Dropping the index without dropping the declaration would
-- put the drift report straight back to six NOT FOUND lines, and
-- `migration-catalogue.test.ts` — which replays this text — would red on the next
-- CI run. Both halves or neither.
--
-- WHY `IF EXISTS` AND NOT A GUARDED ASSERTION LIKE 0053's. 0053 asserts each of
-- its renames LANDED, because a guarded rename that silently did nothing leaves
-- the drift exactly where it was and reports success. A DROP has no such failure
-- shape: the post-condition is "the index is not there", and `IF EXISTS` reaches
-- it from either starting state. What IS asserted below is the other half — that
-- the WIDER index each of these leans on is still present. Dropping a redundant
-- index is only safe while the thing that makes it redundant exists, and nothing
-- else in the repository checks that pairing.
--
-- SAFE IN ONE TRANSACTION. `DROP INDEX` takes ACCESS EXCLUSIVE on the index's
-- table for as long as the batch runs, and does no scan and no rebuild. Six
-- tables, catalogue-only, milliseconds. CONCURRENTLY is not available anyway: it
-- cannot run inside a transaction block and `db:migrate` runs every pending
-- migration in ONE.
--
-- REVERSING IT is the CREATE INDEX block in 0053:205-212, copied verbatim.
DO $$
DECLARE
  absent text[];
BEGIN
  -- ------------------------------------------- (a) the wider index must be there
  -- Checked BEFORE the drops, so a database missing one of these loses nothing:
  -- the RAISE aborts the whole batch and every index is still where it was.
  SELECT coalesce(array_agg(name), '{}'::text[]) INTO absent
    FROM (VALUES
      ('boqs_org_project_idx'),                    -- answers boqs_project_idx
      ('boq_sections_org_boq_sort_idx'),           -- answers boq_sections_boq_idx
      ('boq_lines_org_boq_idx'),                   -- answers boq_lines_boq_idx
      ('boq_lines_org_section_sort_idx'),          -- answers boq_lines_section_idx
      ('contract_sections_org_contract_sort_idx'), -- answers contract_sections_contract_idx
      ('project_stages_org_project_sort_idx')      -- answers project_stages_project_idx
    ) AS t(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = t.name
   );
  IF cardinality(absent) > 0 THEN
    RAISE EXCEPTION '0054: refusing to drop — the wider index/indexes % are MISSING, so the redundant ones are not redundant on this database', array_to_string(absent, ', ');
  END IF;

  -- ----------------------------------------------------------- (b) the six drops
  -- Each is named with the index that answers it, the same pairing 0053:205-212
  -- wrote when it created them.
  DROP INDEX IF EXISTS public.boqs_project_idx;               -- == boqs_org_project_idx
  DROP INDEX IF EXISTS public.boq_sections_boq_idx;           -- prefix of boq_sections_org_boq_sort_idx
  DROP INDEX IF EXISTS public.boq_lines_boq_idx;              -- == boq_lines_org_boq_idx
  DROP INDEX IF EXISTS public.boq_lines_section_idx;          -- prefix of boq_lines_org_section_sort_idx
  DROP INDEX IF EXISTS public.contract_sections_contract_idx; -- prefix of contract_sections_org_contract_sort_idx
  DROP INDEX IF EXISTS public.project_stages_project_idx;     -- prefix of project_stages_org_project_sort_idx

  RAISE NOTICE '0054: six redundant indexes dropped; their wider pairs verified present.';
END $$;
