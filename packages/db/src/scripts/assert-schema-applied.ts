// Does the database this URL points at have every object the code expects?
//
// THE FAILURE THIS EXISTS TO PREVENT. Deploying code before its migration is not
// a degraded state for the engagement module, it is a TOTAL one: drizzle's
// `select()` emits an explicit column list built from the schema file, so ONE
// missing column makes the whole SELECT fail with 42703 (undefined_column).
// Against a database at 0048, `select()` on engagement_events raises 42703 for
// acknowledged_issue_at and on engagement_transitions for idempotency_key — and
// loadGuardFacts full-row-selects both, so EVERY transition fails, along with the
// timeline, the badge and the corrections path (eight call sites). There is no
// partial degradation to notice: the module simply stops.
//
// deploy.yml cannot run this — it holds no database credential, only
// CLOUDFLARE_API_TOKEN — so this is the OWNER'S pre-merge step, with the exact
// command in docs/DEPLOY.md. Read-only: it opens one connection, reads
// catalogues, and writes nothing.
//
// FOUR KINDS, ONE EXIT CODE — and the exit code is COLUMNS ONLY.
//
//   columns      (gate)          declaredTables()      vs information_schema.columns
//   indexes      (report only)   declaredIndexes()     vs pg_indexes
//   constraints  (report only)   declaredConstraints() vs pg_constraint
//   functions    (report only)   declaredFunctions()   vs pg_proc
//
// The three new sections PRINT and do not gate, deliberately:
//
//   (a) identifier drift is real and already known. 0017 wrote six index names
//       and six constraint names UNQUOTED in camelCase, so Postgres folded them
//       to lower case — in production AND in every fresh CI database built from
//       these migrations. A case-sensitive gate would therefore go red
//       everywhere, over a defect it is merely reporting.
//   (b) this check runs read-only BEFORE `apply-rls` in the deploy order
//       (docs/DEPLOY.md), so a function-name gate would refuse to start on any
//       function that the pending apply-rls run is about to create.
//
// For the same reason it is NOT a CI step: CI's fresh database is built from the
// same migrations and would show the same folded names.
//
// What the code declares, and how a name is compared, lives in
// `schema-catalogue.ts` — which has no connection and is unit-tested.
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import {
  declaredConstraints,
  declaredFunctions,
  declaredIndexes,
  declaredTables,
  missingColumns,
  missingNames,
} from './schema-catalogue';

type Sql = ReturnType<typeof createSql>;

/** Every table the DATABASE has in `public`, as table name -> column names. */
async function appliedTables(sql: Sql): Promise<Map<string, Set<string>>> {
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
  sql: Sql,
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

async function main() {
  const sql = createSql(MIGRATION_DATABASE_URL(), { max: 1, prepare: false });
  try {
    const declared = declaredTables();
    const gaps = missingColumns(declared, await appliedTables(sql));

    const indexes = declaredIndexes();
    const constraints = declaredConstraints();
    const functions = declaredFunctions();
    const indexGaps = missingNames(indexes, await appliedNames(sql, 'index'));
    const constraintGaps = missingNames(constraints, await appliedNames(sql, 'constraint'));
    const functionGaps = missingNames(functions, await appliedNames(sql, 'function'));

    if (gaps.length > 0) {
      console.error(
        'assert-schema-applied: this database is BEHIND the code.\n' +
          `${gaps.join('\n')}\n\n` +
          'Run `npm run migrate -w @metra/db` (then `npm run apply-rls -w @metra/db`) ' +
          'BEFORE shipping this code. Deploying first is not a partial outage: ' +
          "drizzle names every column in its SELECT, so one missing column is 42703 " +
          'for the whole query.',
      );
      process.exit(1);
    }
    console.log(
      `assert-schema-applied: OK — ${declared.size} declared table(s), every column present.`,
    );

    const total =
      report('indexes', indexes.size, indexGaps) +
      report('constraints', constraints.size, constraintGaps) +
      report('functions', functions.size, functionGaps);
    if (total > 0) console.log(DRIFT_NOTE);
  } finally {
    await sql.end();
  }
}

main().catch((error: Error) => {
  console.error('assert-schema-applied failed:', error.message);
  process.exit(1);
});
