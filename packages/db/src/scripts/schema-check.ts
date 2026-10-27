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
import { declaredFunctions } from './rls-catalogue';
import {
  declaredCompositeSetNullFks,
  declaredConstraints,
  declaredIndexes,
  declaredTables,
  missingColumns,
  missingNames,
} from './schema-catalogue';
import { appliedNames, appliedTables, compositeSetNullFks } from './schema-check-catalogue-reads';
import { reportCompositeSetNullFks } from './schema-check-composite-fks';
import { readOrphanSection, reportOrphans } from './schema-check-orphans';

/**
 * The postgres.js handle. Every catalogue query is a STATIC tagged template with no
 * interpolation at all, so a unit test supplies a fixture that answers on the
 * query text and casts it to this type once.
 */
export type CatalogueSql = ReturnType<typeof createSql>;

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
  '\nThose three sections are REPORT ONLY: the exit code is governed by columns ' +
  'and by composite set-null foreign keys, not by names.\n' +
  'A name that differs only in CASE means the object was created by an UNQUOTED ' +
  'camelCase identifier in a hand-authored migration, which Postgres folded to ' +
  'lower case — in every database built from these migrations, production and CI ' +
  'alike. Compare the catalogue against `src/schema/` before assuming the object ' +
  'is missing: the fix is a schema-side name alignment or a rename migration, ' +
  'never a re-create.\n' +
  'A name absent under ANY casing is either an index the schema declares that no ' +
  'migration ever created, or an `apply-rls` object this database has not had ' +
  'applied yet.';

/** Print the column section: the one that says the database is BEHIND the code. */
function reportColumnGaps(declared: Map<string, Set<string>>, columnGaps: string[]): void {
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
}

/**
 * Read the catalogues, print every section, and return the process exit code.
 *
 * TWO THINGS GATE IT. Columns, as before (PM ruling 1b): a database behind the
 * code is 42703 for whole queries. And, since wave 7, any composite set-null
 * foreign key that is not narrowed to exactly one of its own non-`org_id`
 * columns. The argument that keeps names REPORT ONLY — a case-sensitive gate
 * would go red everywhere over a defect it is merely reporting — does not apply
 * to this one: after 0052 the expected value is exactly zero on every database,
 * and a non-zero is a referential defect rather than a naming one.
 *
 * The report-only sections print on the failing run too: that is the run whose
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

  reportColumnGaps(declared, columnGaps);
  const total =
    report('indexes', indexes.size, indexGaps) +
    report('constraints', constraints.size, constraintGaps) +
    report('functions', functions.size, functionGaps);
  if (total > 0) console.log(DRIFT_NOTE);

  // The fifth section, report-only for the same reason the three above are: the
  // exit code belongs to the two things that make the DEPLOYED CODE fail, and an
  // orphaned row is a data incident on an existing database.
  reportOrphans(await readOrphanSection(sql));

  const compositeFks = await compositeSetNullFks(sql);
  const composite = reportCompositeSetNullFks(compositeFks, declaredCompositeSetNullFks().size);

  return columnGaps.length > 0 || composite.unnarrowed > 0 || composite.behind ? 1 : 0;
}
