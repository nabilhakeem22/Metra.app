import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrationCatalogue } from './migration-catalogue';
import {
  declaredCompositeSetNullFks,
  declaredConstraints,
  declaredIndexes,
} from './schema-catalogue';

// DOES A MIGRATION ACTUALLY CREATE WHAT THE SCHEMA DECLARES, UNDER THAT EXACT NAME?
//
// Nothing in this repository could answer that before wave 7. `db:assert-snapshot`
// compares the schema with the drizzle snapshot, which is derived from the SCHEMA -
// both sides move together, so it is blind to a migration that was never written.
// `assert-schema-applied` compares the schema with a LIVE database, needs a
// credential, is deliberately not a CI step, and is run by a human once per deploy
// at best. That is how `boqs_client_idx` and `boqs_engagement_idx` were declared for
// a whole wave with no migration behind them, and how twelve names drifted into a
// case-folded spelling in every database ever built from these files.
//
// This test closes the gap with no database: it replays the migration TEXT and
// asserts the resulting catalogue contains every index and every named constraint
// `src/schema/` declares, spelled identically. On CI it runs in the `unit tests
// (db)` step, five steps before Postgres is touched.
//
// WHAT A FAILURE MEANS, in the two directions it can point:
//   * a name in `missing` with a near-identical sibling -> identifier drift. Someone
//     wrote camelCase unquoted and Postgres folded it. Fix with a RENAME migration
//     (0053 is the worked example), never by re-creating the object.
//   * a name in `missing` with no sibling at all -> the schema declares an object no
//     migration creates. It does not exist in production either.
//
// It cannot see dynamic SQL, and that is a deliberate constraint on how migrations
// may be written: see the KNOWN LIMITS block in `migration-catalogue.ts`.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');

const catalogue = migrationCatalogue(migrationsFolder);

/** `name (on table)`, so a failure names the table without a second lookup. */
function missing(declared: Map<string, string>, built: Set<string>): string[] {
  return [...declared]
    .filter(([name]) => !built.has(name))
    .map(([name, table]) => `${name} (on ${table})`)
    .sort();
}

describe('every declared object is built by some migration, under that exact name', () => {
  it('finds the migrations it is meant to be replaying', () => {
    // A guard on the guard: a wrong folder, or a replay that silently read
    // nothing, would make both assertions below pass by checking an empty schema
    // against an empty catalogue.
    expect(catalogue.indexes.size).toBeGreaterThan(100);
    expect(catalogue.constraints.size).toBeGreaterThan(200);
    expect(declaredIndexes().size).toBeGreaterThan(100);
    expect(declaredConstraints().size).toBeGreaterThan(200);
  });

  it('creates every index src/schema/ declares', () => {
    expect(missing(declaredIndexes(), catalogue.indexes)).toEqual([]);
  });

  it('creates every named constraint src/schema/ declares', () => {
    expect(missing(declaredConstraints(), catalogue.constraints)).toEqual([]);
  });

  it('applies statements in TEXTUAL order, not create-then-drop', () => {
    // 0006 and 0049 each DROP an index and CREATE it again in the SAME file. A
    // replay that batched by statement kind would end with the name deleted, and
    // both of these would sit in `missing` forever with no defect behind them.
    expect(catalogue.indexes.has('invitations_org_email_pending_idx')).toBe(true);
    expect(catalogue.indexes.has('engagement_events_client_signal_unique')).toBe(true);
  });

  it('folds an unquoted identifier and keeps a quoted one, as Postgres does', () => {
    const built = migrationCatalogue(migrationsFolder);
    // 0017 wrote this one unquoted in camelCase; 0053 renames the folded form to
    // the quoted camelCase spelling. Both facts are visible here.
    expect(built.indexes.has('contract_lines_costItem_idx')).toBe(true);
    expect(built.indexes.has('contract_lines_costitem_idx')).toBe(false);
    // 0041 wrote this constraint in snake_case; 0053 renames it.
    expect(built.constraints.has('boqs_sourceFile_same_org_fk')).toBe(true);
    expect(built.constraints.has('boqs_source_file_same_org_fk')).toBe(false);
  });

  it('does not report an index whose DECLARATION was dropped with it (0054)', () => {
    // 0054 drops six indexes 0053 created, and the same commit drops their six
    // DECLARATIONS (`sameOrgFk(…, { index: false })`). Neither half is allowed to
    // ship alone, and this is the half that proves the FIRST direction: the
    // catalogue no longer builds them, the schema no longer declares them, and
    // the comparison above therefore says nothing about them. If the declarations
    // had been left behind, `creates every index src/schema/ declares` would be
    // red with exactly these six names.
    const dropped = [
      'boqs_project_idx',
      'boq_sections_boq_idx',
      'boq_lines_boq_idx',
      'boq_lines_section_idx',
      'contract_sections_contract_idx',
      'project_stages_project_idx',
    ];
    for (const name of dropped) {
      expect(catalogue.indexes.has(name), `${name} is still built by a migration`).toBe(false);
      expect(declaredIndexes().has(name), `${name} is still declared in src/schema/`).toBe(false);
    }
    // And the wider index each one leaned on is still both declared and built —
    // which is the only thing that made dropping them safe.
    for (const wider of [
      'boqs_org_project_idx',
      'boq_sections_org_boq_sort_idx',
      'boq_lines_org_boq_idx',
      'boq_lines_org_section_sort_idx',
      'contract_sections_org_contract_sort_idx',
      'project_stages_org_project_sort_idx',
    ]) {
      expect(catalogue.indexes.has(wider), `${wider} is not built by any migration`).toBe(true);
      expect(declaredIndexes().has(wider), `${wider} is not declared in src/schema/`).toBe(true);
    }
  });

  it('carries no object that only a MESSAGE names', () => {
    // F5: `RAISE EXCEPTION '0053: constraint name(s) not renamed: %'` matched
    // `constraint <identifier>` inside the preserved literal and put a phantom
    // constraint called `name` into the real catalogue. Surplus names are never
    // reported (the comparison is one-directional), so this one was invisible.
    expect(catalogue.constraints.has('name')).toBe(false);
    // Every real constraint in this schema is `<table>_<what>_<kind>`; a bare
    // word is prose that got read as SQL.
    for (const name of catalogue.constraints) expect(name).toMatch(/_/);
  });
});

describe('0052 narrows exactly the composite set-null FKs the schema declares', () => {
  // THE TWO CENSUSES THAT MUST AGREE, with no database between them.
  //
  //   * 0052's own `FROM (VALUES …) AS t(child, conname, child_col, parent)`
  //     table — the twelve constraints the migration narrows, and the list
  //     `composite-fk-cascade.dbtest.ts` counts against a real catalogue;
  //   * `declaredCompositeSetNullFks()` — the FLOOR `assert-schema-applied` uses
  //     on production.
  //
  // They were eleven and twelve for one wave, because `files.ts` declared no FK
  // for `category_id` while every database held one (0040 wrote it by hand). The
  // floor was therefore BELOW what the database had, and a silent un-narrowing of
  // that twelfth would have passed the production-side gate. Wave 8 item 1 closed
  // it in `files.ts`; this case is what refuses to let the two drift apart again,
  // in EITHER direction — a thirteenth FK declared in `src/schema/` with no row in
  // 0052, or a row in 0052 with no declaration.
  const text = readFileSync(resolve(migrationsFolder, '0052_composite_fk_set_null_columns.sql'), 'utf8');

  // COMPARED AS EDGES, NOT AS NAMES. 0052 spells six of its twelve in the
  // pre-rename form (`boqs_source_file_same_org_fk`, the case-folded
  // `variation_order_lines_costitem_…`, and so on) because that is what the
  // catalogue held when it ran; 0053 renames them afterwards. A name comparison
  // would therefore be red on a correct tree. `<child table>.<referencing
  // column>` is the same edge under every spelling, and is what both files are
  // actually about.
  function narrowedBy0052(): string[] {
    const table = /FROM \(VALUES([\s\S]*?)\) AS t\(child, conname, child_col, parent\)/.exec(text);
    if (!table) {
      throw new Error(
        '0052 no longer carries a `FROM (VALUES …) AS t(child, conname, child_col, parent)` table',
      );
    }
    const rows = [
      ...table[1].matchAll(/\(\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*'([^']*)'\s*,\s*'[^']*'\s*\)/g),
    ];
    if (rows.length === 0) throw new Error('0052 declares no foreign keys to narrow');
    return rows.map((row) => `${row[1]}.${row[2]}`).sort();
  }

  /** The same edges, as `src/schema/` declares them. */
  function declaredEdges(): string[] {
    return [...declaredCompositeSetNullFks().values()]
      .map((fk) => `${fk.table}.${fk.columns.join('+')}`)
      .sort();
  }

  it('narrows exactly the edges the schema declares — twelve, both sides', () => {
    expect(narrowedBy0052()).toHaveLength(12);
    expect(declaredCompositeSetNullFks().size).toBe(12);
    expect(narrowedBy0052()).toEqual(declaredEdges());
  });

  it('carries files.category_id on both sides', () => {
    // The edge that was missing from the SCHEMA side until wave 8 item 1. Named
    // rather than left to the set comparison, because a failure here should say
    // which of the two gates slipped.
    expect(narrowedBy0052()).toContain('files.category_id');
    expect(declaredCompositeSetNullFks().get('files_category_same_org_fk')).toEqual({
      table: 'files',
      columns: ['category_id'],
    });
  });
});

/** A throwaway migrations folder: a journal plus the given files, in order. */
function folderOf(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), 'metra-catalogue-'));
  mkdirSync(join(folder, 'meta'));
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ entries: Object.keys(files).map((tag, idx) => ({ idx, tag })) }),
  );
  for (const [tag, sql] of Object.entries(files)) writeFileSync(join(folder, `${tag}.sql`), sql);
  return folder;
}

describe('a DROP with the declaration left behind is RED (0054, the other half)', () => {
  // The direction the case on the real tree cannot show, because on the real tree
  // both halves landed together. This is the shape of a half-done 0054: the
  // migration drops the index, `src/schema/` still declares it, and the gate must
  // name it rather than shrug. `missing()` is the same comparison the three cases
  // above run against the real catalogue.
  it('reports an index a migration dropped while the schema still declares it', () => {
    const built = migrationCatalogue(
      folderOf({
        '0001_create': 'CREATE INDEX IF NOT EXISTS boqs_project_idx ON public.boqs (org_id, project_id);',
        '0002_drop': `DO $$ BEGIN
           DROP INDEX IF EXISTS public.boqs_project_idx;
         END $$;`,
      }),
    );
    expect(built.indexes.has('boqs_project_idx')).toBe(false);
    expect(missing(new Map([['boqs_project_idx', 'boqs']]), built.indexes)).toEqual([
      'boqs_project_idx (on boqs)',
    ]);
  });

  it('reads a schema-qualified DROP inside a DO body, which is how 0054 spells it', () => {
    // If the replay could not see `DROP INDEX IF EXISTS public.<name>` inside a
    // `DO $$ … $$`, 0054 would be a no-op to this gate and the six names would sit
    // in the catalogue for ever — green for the wrong reason.
    const real = migrationCatalogue(migrationsFolder);
    const dropText = readFileSync(
      resolve(migrationsFolder, '0054_drop_redundant_indexes.sql'),
      'utf8',
    );
    expect(dropText).toContain('DROP INDEX IF EXISTS public.boqs_project_idx;');
    expect(real.indexes.has('boqs_project_idx')).toBe(false);
  });
});

describe('a name inside a string literal is PROSE, and moves nothing', () => {
  it('cannot satisfy the check for an index no statement creates (F2)', () => {
    // The evasion, measured on the real tree before this fix: delete the
    // `CREATE INDEX IF NOT EXISTS boqs_client_idx` line from 0053, add a RAISE
    // NOTICE that merely NAMES it, and the gate went green again. Not
    // hypothetical prose — 0052 and 0053 both name indexes and constraints in
    // their RAISE messages.
    const built = migrationCatalogue(
      folderOf({
        '0001_talk': `DO $$ BEGIN
           RAISE NOTICE 'runbook: create index boqs_client_idx on public.boqs (org_id, client_id)';
         END $$;`,
      }),
    );
    expect(built.indexes.has('boqs_client_idx')).toBe(false);
  });

  it('cannot DELETE a constraint some statement really created (F5)', () => {
    const built = migrationCatalogue(
      folderOf({
        '0001_create': 'ALTER TABLE public.t ADD CONSTRAINT real_con CHECK (n > 0);',
        '0002_talk': `DO $$ BEGIN
           RAISE NOTICE 'to undo by hand: alter table t drop constraint real_con';
         END $$;`,
      }),
    );
    // The false-RED direction: it would send someone hunting a defect that is
    // not there.
    expect(built.constraints.has('real_con')).toBe(true);
  });

  it('still reads the DDL inside a dollar-quoted DO body (F6)', () => {
    // The body is TRANSPARENT, not stripped: every statement 0052 and 0053 run
    // is inside one, and a reader that skipped them would replay an empty file
    // and report the whole schema missing. A `--` comment in the body is still
    // a comment.
    const built = migrationCatalogue(
      folderOf({
        '0001_do': `DO $$ BEGIN
           -- CREATE INDEX commented_idx ON public.t (a);
           CREATE INDEX IF NOT EXISTS real_idx ON public.t (a);
         END $$;`,
      }),
    );
    expect([...built.indexes]).toEqual(['real_idx']);
  });
});

describe('an E-string is a string too (L2)', () => {
  // `E'it\'s'` escapes the quote with a BACKSLASH, which a plain-literal reader
  // takes as the end of the string. The trailing real quote then REOPENS one and
  // swallows everything to the next quote or to EOF - both directions are
  // measured below, and the second is the one this gate has no other defence
  // against. String.raw, so what the test writes is what the migration holds.
  it('does not let an escaped quote DELETE a constraint (false red)', () => {
    const built = migrationCatalogue(
      folderOf({
        '0001_create': 'ALTER TABLE public.t ADD CONSTRAINT real_con CHECK (n > 0);',
        '0002_talk': String.raw`DO $$ BEGIN
           RAISE NOTICE E'it\'s: alter table t drop constraint real_con';
         END $$;`,
      }),
    );
    expect(built.constraints.has('real_con')).toBe(true);
  });

  it('does not let one SWALLOW the statements after it (false green)', () => {
    const built = migrationCatalogue(
      folderOf({
        '0001_create': 'CREATE INDEX IF NOT EXISTS doomed_idx ON public.t (a);',
        '0002_after': String.raw`DO $$ BEGIN
           RAISE NOTICE E'it\'s done';
           DROP INDEX IF EXISTS public.doomed_idx;
           CREATE INDEX IF NOT EXISTS after_e_idx ON public.t (b);
         END $$;`,
      }),
    );
    // Before this fix the DROP was invisible - the index stayed in the catalogue
    // - and the index created after the E-string was never seen at all.
    expect(built.indexes.has('doomed_idx')).toBe(false);
    expect(built.indexes.has('after_e_idx')).toBe(true);
  });

  it('leaves a PLAIN literal alone, where a backslash escapes nothing', () => {
    // With standard_conforming_strings on, that quote really does end the string.
    const built = migrationCatalogue(
      folderOf({
        '0001_plain': String.raw`SELECT 'a trailing backslash \';
           CREATE INDEX IF NOT EXISTS plain_idx ON public.t (a);`,
      }),
    );
    expect(built.indexes.has('plain_idx')).toBe(true);
  });
});
