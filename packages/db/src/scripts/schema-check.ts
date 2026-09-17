// The four catalogue reads and the report they print, given an open connection.
//
// Split out of `assert-schema-applied.ts` for the same reason
// `schema-catalogue.ts` was: that file is a CLI which opens a connection from
// the environment and sets an exit code, so importing it to test its logic
// would try to reach a database. This half takes the handle as an argument and
// RETURNS the exit code, so a fixture socket exercises the real control flow.
//
// AND THE CONTROL FLOW IS THE POINT. The previous version queried all four
// catalogues and then exited on the column gap BEFORE printing the other three,
// so the only run where the owner is being told something is wrong was the one
// run that printed a single section. This orders it the other way round:
// everything prints, THEN the exit code is returned.
import type { createSql } from '../client';
import {
  declaredConstraints,
  declaredFunctions,
  declaredIndexes,
  declaredTables,
  missingColumns,
  missingNames,
} from './schema-catalogue';

/**
 * The postgres.js handle. Every query below is a STATIC tagged template with no
 * interpolation at all, so a unit test supplies a fixture that answers on the
 * query text and casts it to this type once.
 */
export type CatalogueSql = ReturnType<typeof createSql>;

/** Every table the DATABASE has in `public`, as table name -> column names. */
async function appliedTables(sql: CatalogueSql): Promise<Map<string, Set<string>>> {
  const rows = (await sql`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `) as unknown as Array<{ table_name: string; column_name: string }>;
  const applied = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = applied.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    applied.set(row.table_name, columns);
  }
  return applied;
}

/** Every index / constraint / function name the DATABASE has in `public`. */
async function appliedNames(
  sql: CatalogueSql,
  kind: 'index' | 'constraint' | 'function',
): Promise<Set<string>> {
  const rows = (await (kind === 'index'
    ? sql`select indexname as name from pg_indexes where schemaname = 'public'`
    : kind === 'constraint'
      ? sql`select c.conname as name
              from pg_constraint c
              join pg_namespace n on n.oid = c.connamespace
             where n.nspname = 'public'`
      : sql`select p.proname as name
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'`)) as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** Print one report-only section. Returns its gap count, for the closing note. */
function report(title: string, declaredCount: number, gaps: string[]): number {
  if (gaps.length === 0) {
    console.log(
      `assert-schema-applied: ${title} — ${declaredCount} declared, all present.`,
    );
    return 0;
  }
  console.log(
    `assert-schema-applied: ${title} — ${declaredCount} declared, ${gaps.length} ` +
      `NOT FOUND (report only, does not fail this check):\n${gaps.join('\n')}`,
  );
  return gaps.length;
}

const DRIFT_NOTE =
  '\nThose three sections are REPORT ONLY: the exit code above is governed by ' +
  'columns alone.\n' +
  'A name that differs only in CASE means the object was created by an UNQUOTED ' +
  'camelCase identifier in a hand-authored migration, which Postgres folded to ' +
  'lower case — in every database built from these migrations, production and CI ' +
  'alike. Compare the catalogue against `src/schema/` before assuming the object ' +
  'is missing: the fix is a schema-side name alignment or a rename migration, ' +
  'never a re-create.\n' +
  'A name absent under ANY casing is either an index the schema declares that no ' +
  'migration ever created, or an `apply-rls` object this database has not had ' +
  'applied yet.';

/**
 * Read all four catalogues, print all four sections, and return the process
 * exit code — which is governed by COLUMNS ALONE (PM ruling 1b). The three
 * report-only sections print on the failing run too: that is the run whose
 * output gets pasted into an incident, and it is the one that most needs to say
 * what ELSE is out of step.
 */
export async function runSchemaCheck(sql: CatalogueSql): Promise<number> {
  const declared = declaredTables();
  const columnGaps = missingColumns(declared, await appliedTables(sql));

  const indexes = declaredIndexes();
  const constraints = declaredConstraints();
  const functions = declaredFunctions();
  const indexGaps = missingNames(indexes, await appliedNames(sql, 'index'));
  const constraintGaps = missingNames(constraints, await appliedNames(sql, 'constraint'));
  const functionGaps = missingNames(functions, await appliedNames(sql, 'function'));

  if (columnGaps.length > 0) {
    console.error(
      'assert-schema-applied: this database is BEHIND the code.\n' +
        `${columnGaps.join('\n')}\n\n` +
        'Run `npm run migrate -w @metra/db` (then `npm run apply-rls -w @metra/db`) ' +
        'BEFORE shipping this code. Deploying first is not a partial outage: ' +
        'drizzle names every column in its SELECT, so one missing column is 42703 ' +
        'for the whole query.',
    );
  } else {
    console.log(
      `assert-schema-applied: OK — ${declared.size} declared table(s), every column present.`,
    );
  }

  const total =
    report('indexes', indexes.size, indexGaps) +
    report('constraints', constraints.size, constraintGaps) +
    report('functions', functions.size, functionGaps);
  if (total > 0) console.log(DRIFT_NOTE);

  return columnGaps.length > 0 ? 1 : 0;
}
