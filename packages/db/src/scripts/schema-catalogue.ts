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
