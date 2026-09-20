// What the CODE declares, and how a declared name is compared with a catalogue.
//
// Split out of `assert-schema-applied.ts` so it can be unit-tested: that file is
// a CLI which opens a connection and calls `process.exit`, so importing it to
// test its logic would try to reach a database. Nothing here touches a socket or
// reads an environment variable.
//
// ONE-DIRECTIONAL, ALWAYS. These helpers only ever answer "what does the code
// declare that the database lacks". Extra objects in the database are legitimate
// and are never reported: RLS policies, roles and the `app_*` functions are
// applied by `apply-rls` and are invisible to the drizzle schema, and
// hand-authored migrations have added indexes on purpose.
//
// The DRIZZLE SCHEMA is the only source read here. What the RLS *SQL* declares -
// functions, policies, triggers - is parsed out of the manifest files by
// `rls-catalogue.ts`; `missingNames` below serves both.
//
// Name comparison is EXACT and case-sensitive, because that is what Postgres
// does with a quoted identifier — and the case drift is the thing worth seeing.
// 0017 wrote six index names and six constraint names UNQUOTED in camelCase, so
// every database built from these migrations (production AND every fresh CI
// database) holds the folded lower-case form while the schema declares the
// camelCase one. `missingNames` says so in as many words rather than reporting
// twelve objects as "missing".
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index';

/** Every table the CODE declares, as table name -> column names. */
export function declaredTables(): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    declared.set(config.name, new Set(config.columns.map((column) => column.name)));
  }
  return declared;
}

/** The tenant key. A table that has it is org-scoped; there is no other rule. */
const ORG_COLUMN = 'org_id';

/**
 * Every ORG-SCOPED table the code declares, sorted — every table carrying an
 * `org_id` column, which is the same predicate the isolation gate and
 * `assert-schema-applied`'s orphan section use.
 *
 * DERIVED, because the alternative has already failed once: the fixture's own
 * teardown list was hand-maintained and silently lost the BOQ tables when 0041
 * landed, and under `session_replication_role = 'replica'` a missing table
 * ORPHANS rows instead of raising. A list nobody has to remember to edit cannot
 * lose a table.
 *
 * What it cannot do is ORDER them. The purge's delete order is FK-driven and
 * child-first; this answers "is every table covered", never "in what order".
 */
export function orgScopedTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.columns.some((column) => column.name === ORG_COLUMN)) names.push(config.name);
  }
  return names.sort();
}

/** Every index name the CODE declares, as index name -> the table it is on. */
export function declaredIndexes(): Map<string, string> {
  const declared = new Map<string, string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const index of config.indexes) {
      const name = index.config.name;
      if (name) declared.set(name, config.name);
    }
  }
  return declared;
}

/**
 * Every table CONSTRAINT name the CODE declares - CHECKs, UNIQUEs and the
 * composite same-org foreign keys - as constraint name -> the table it is on.
 */
export function declaredConstraints(): Map<string, string> {
  const declared = new Map<string, string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const check of config.checks) declared.set(check.name, config.name);
    for (const unique of config.uniqueConstraints) {
      // drizzle lets a unique() be anonymous, in which case Postgres invents the
      // name and there is nothing here to compare.
      if (unique.name) declared.set(unique.name, config.name);
    }
    for (const fk of config.foreignKeys) declared.set(fk.getName(), config.name);
  }
  return declared;
}

/**
 * One composite `on delete set null` foreign key as `src/schema/` declares it:
 * the table it is on, and the referencing columns that are NOT `org_id`.
 *
 * The columns are carried because a CONSTRAINT NAME is not a durable identity
 * here — 0053 renamed ten of them and 0052 still spells six in the pre-rename
 * form — while `(table, column)` is the same edge whatever anyone calls it. That
 * is what `migration-catalogue.test.ts` compares 0052's narrowing table against.
 */
export interface CompositeSetNullFk {
  table: string;
  columns: string[];
}

/**
 * Every COMPOSITE `on delete set null` foreign key the CODE declares — every
 * `sameOrgFk(…, { onDelete: 'set null' })` — as constraint name -> its edge.
 *
 * It exists to give `assert-schema-applied`'s composite set-null section a FLOOR.
 * That section reads the database and reports what it finds; against an empty
 * answer it printed "0 found, every one narrowed" and exited 0, which is the
 * shape of every gate that has no guard on the guard (wave 7 L3).
 *
 * TWELVE today, and moving it there is what wave 8's first commit is for. It
 * read eleven for one wave because 0040 hand-wrote `files_category_same_org_fk`
 * without going through `sameOrgFk` and `files.ts` declared it nowhere — so the
 * only thing asserting that twelfth stayed narrow was one dbtest count, and the
 * production-side gate, with a floor of eleven, would not have noticed its loss.
 * `files.ts` declares it now and this number followed the schema; no literal was
 * edited here, and none is written down anywhere.
 *
 * STILL A FLOOR AND NOT AN EQUALITY, deliberately: this file is one-directional
 * everywhere else, a composite set-null FK the database holds and the code does
 * not declare is `assert-schema-applied`'s to REPORT rather than to fail on, and
 * an equality would turn the next such discovery into a red gate on every
 * database at once instead of a line in a report.
 */
export function declaredCompositeSetNullFks(): Map<string, CompositeSetNullFk> {
  const declared = new Map<string, CompositeSetNullFk>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const fk of config.foreignKeys) {
      if (fk.onDelete !== 'set null') continue;
      const referencing = fk.reference().columns;
      if (referencing.length < 2) continue;
      declared.set(fk.getName(), {
        table: config.name,
        columns: referencing.map((column) => column.name).filter((name) => name !== 'org_id'),
      });
    }
  }
  return declared;
}

/** One line per column the code needs and the database does not have. */
export function missingColumns(
  declared: Map<string, Set<string>>,
  applied: Map<string, Set<string>>,
): string[] {
  const gaps: string[] = [];
  for (const [table, columns] of declared) {
    const live = applied.get(table);
    if (!live) {
      gaps.push(`  - table ${table} is missing entirely`);
      continue;
    }
    const absent = [...columns].filter((column) => !live.has(column));
    if (absent.length > 0) gaps.push(`  - ${table}: ${absent.join(', ')}`);
  }
  return gaps;
}

/**
 * One line per declared name the database does not have under that EXACT
 * spelling, annotated when a case-insensitive match exists - which is the
 * likely answer here, and a completely different fix from "the object is
 * missing".
 */
export function missingNames(
  declared: Map<string, string>,
  applied: Set<string>,
): string[] {
  const lowered = new Map<string, string>();
  for (const name of applied) lowered.set(name.toLowerCase(), name);
  const gaps: string[] = [];
  for (const [name, owner] of declared) {
    if (applied.has(name)) continue;
    const folded = lowered.get(name.toLowerCase());
    gaps.push(
      folded
        ? `  - ${name} (on ${owner}) — the database has "${folded}": a CASE-ONLY difference`
        : `  - ${name} (on ${owner}) — not in the catalogue under any casing`,
    );
  }
  return gaps;
}
