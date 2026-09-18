import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrationCatalogue } from './migration-catalogue';
import { declaredConstraints, declaredIndexes } from './schema-catalogue';

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
