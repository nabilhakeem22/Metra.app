import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrationCatalogue, withoutComments } from './migration-catalogue';
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

  it('does not mistake a `--` inside a string literal for a comment', () => {
    const kept = withoutComments(`select 'a -- b' as x; -- gone\nselect 1`);
    expect(kept).toContain("'a -- b'");
    expect(kept).not.toContain('gone');
  });
});
