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
  ORGANIZATIONS_VISIBLE_QUERY,
  orphanOrgRowsQuery,
  orphanReportLines,
  type OrphanOrgRows,
} from './org-orphan-rows';
import { declaredFunctions } from './rls-catalogue';
import {
  declaredCompositeSetNullFks,
  declaredConstraints,
  declaredIndexes,
  declaredTables,
  missingColumns,
  missingNames,
  orgScopedTableNames,
} from './schema-catalogue';

/**
 * The postgres.js handle. Every query below is a STATIC tagged template with no
 * interpolation at all, so a unit test supplies a fixture that answers on the
 * query text and casts it to this type once.
 */
export type CatalogueSql = ReturnType<typeof createSql>;

/** One composite `ON DELETE SET NULL` foreign key, as the catalogue holds it. */
interface CompositeSetNullFk {
  name: string;
  child: string;
  /** The columns the FK references with, `org_id` included. */
  fk_cols: string[];
  /** The columns it nulls on a parent delete. Empty means "all of them". */
  set_cols: string[];
}

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

/**
 * Every composite FK in `public` whose ON DELETE action is SET NULL, with the
 * columns it nulls and the columns it references.
 *
 * `confdelsetcols` is the field 0052 writes, and the only thing in the catalogue
 * that can tell a NARROWED foreign key from a bare one. Until this section
 * existed, nothing on production asserted 0052 had done anything at all: the
 * constraint comparison above reads `conname` and a narrowing changes no name, so
 * step 3 of the deploy would print `constraints — 218 declared, 0 NOT FOUND` over
 * a catalogue where every one of the twelve still nulled `org_id` on a parent
 * delete (wave 7 R6). It is derived from the catalogue rather than from a list, so
 * a thirteenth such FK added by a future migration is checked without editing this
 * file. Requires PG15+; production and CI are 17.
 */
async function compositeSetNullFks(sql: CatalogueSql): Promise<CompositeSetNullFk[]> {
  return (await sql`
    select c.conname   as name,
           rel.relname as child,
           coalesce(
             (select array_agg(a.attname order by a.attnum)
                from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = any(c.conkey)),
             '{}'::name[]
           ) as fk_cols,
           coalesce(
             (select array_agg(a.attname order by a.attnum)
                from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = any(c.confdelsetcols)),
             '{}'::name[]
           ) as set_cols
      from pg_constraint c
      join pg_class rel   on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and c.contype = 'f'
       and c.confdeltype = 'n'
       and array_length(c.conkey, 1) > 1
     order by 1
  `) as unknown as CompositeSetNullFk[];
}

/**
 * What is wrong with one narrowing, or nothing. A composite set-null FK must null
 * EXACTLY ONE column, that column must be its own referencing column, and it must
 * never be `org_id` — nulling the tenant key on a parent delete is the defect 0052
 * removed, and nulling some OTHER table's column is a hand-applied narrowing that
 * 0052's own idempotency branch would skip without looking (wave 7 S3).
 */
function narrowingProblem(fk: CompositeSetNullFk): string | undefined {
  const referencing = fk.fk_cols.filter((column) => column !== 'org_id');
  if (fk.set_cols.length === 0) return 'nulls EVERY referencing column, org_id included';
  if (fk.set_cols.length !== 1) {
    return `nulls ${fk.set_cols.join(', ')} — a narrowed FK nulls exactly one column`;
  }
  const [only] = fk.set_cols;
  if (only === 'org_id') return 'nulls org_id, which would strip the row of its tenant';
  if (!referencing.includes(only)) {
    return `nulls ${only}, which is not one of its own referencing columns (${referencing.join(', ')})`;
  }
  return undefined;
}

/**
 * Rows whose `org_id` names no organization, per org-scoped table. REPORT ONLY.
 *
 * The same question the purge asks as its post-condition, asked here of whatever
 * database the owner is pointing at. It is the one section that reads USER ROWS
 * rather than a catalogue, which is why it is wrapped: an orphan is a data
 * incident to investigate, never a reason for this script to stop printing the
 * four sections it exists for, and a connection that cannot read a table must not
 * take the report down with it.
 */
/**
 * A row count, whatever the driver made of it — or null when the answer is not a
 * count at all. NEVER `Number(x)` on its own (wave 8 F7): `count(*)` is int8, a
 * driver that hands int8 back as a STRING makes a strict `=== 0` guard dead
 * ('0' is not 0), and `Number(null)` is 0, which would turn "the query answered
 * nothing" into "there are no organizations". Both directions are named here so
 * neither can be reached by accident.
 */
function asCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type OrphanSection =
  /** The read happened. `answered` is how many tables the DATABASE returned. */
  | { kind: 'read'; answered: number; lines: string[] }
  /** The read did not happen, or must not be trusted. Never a row count. */
  | { kind: 'unavailable'; reason: string };

async function orphanOrgRowSection(sql: CatalogueSql): Promise<OrphanSection> {
  const handle = sql as unknown as {
    unsafe: <T>(query: string) => Promise<T>;
  };
  const tables = orgScopedTableNames();
  const [visible] = await handle.unsafe<Array<{ rows: unknown }>>(ORGANIZATIONS_VISIBLE_QUERY);
  if (!visible) {
    return {
      kind: 'unavailable',
      reason: `${ORGANIZATIONS_VISIBLE_QUERY} returned no row at all`,
    };
  }
  const organizations = asCount(visible.rows);
  if (organizations === null) {
    return {
      kind: 'unavailable',
      reason:
        `${ORGANIZATIONS_VISIBLE_QUERY} answered ${JSON.stringify(visible.rows)}, ` +
        'which is not a count',
    };
  }
  if (organizations === 0) {
    return {
      kind: 'unavailable',
      reason:
        'this connection reads 0 rows from public.organizations, so every table would ' +
        'report fully orphaned. Fix the privilege or the RLS on this role, then re-run',
    };
  }
  const counts = await handle.unsafe<OrphanOrgRows[]>(orphanOrgRowsQuery(tables));
  return { kind: 'read', answered: counts.length, lines: orphanReportLines(counts) };
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

/**
 * Print the orphan section. Its own printer because "declared / NOT FOUND" is the
 * wrong sentence for it: nothing is declared and nothing is missing — a row is
 * pointing at an organization that is not there.
 *
 * AND A FAILED READ HAS ITS OWN SENTENCE AGAIN (wave 8 F2). The first version
 * funnelled every branch through one printer, so a REJECTED query, an
 * unreadable `organizations` and an empty visibility row each printed
 * "44 org-scoped table(s) read, 1 WITH ORPHANS" followed by the remediation
 * paragraph telling the operator to go and find rows by org_id. It stated a
 * connection problem as a data incident, over a count of tables nothing had
 * read. An unavailable section now says only that it is unavailable, and names
 * no number it does not have.
 *
 * The count on the READ branch is what the DATABASE ANSWERED (F6), not what
 * `src/schema/` declares: a query that returned 40 rows for 44 declared tables
 * must not print 44.
 */
function reportOrphans(section: OrphanSection): void {
  if (section.kind === 'unavailable') {
    console.log(
      `assert-schema-applied: orphaned org rows — could not be read: ${section.reason}. ` +
        'Nothing is reported about orphaned rows on this run.',
    );
    return;
  }
  if (section.lines.length === 0) {
    console.log(
      `assert-schema-applied: orphaned org rows — ${section.answered} org-scoped table(s) ` +
        'answered, none holds a row whose org_id names no organization.',
    );
    return;
  }
  console.log(
    `assert-schema-applied: orphaned org rows — ${section.answered} org-scoped table(s) ` +
      `answered, ${section.lines.length} WITH ORPHANS (report only, does not fail this ` +
      `check):\n${section.lines.join('\n')}\n` +
      'Every org-scoped table has org_id -> organizations(id) ON DELETE RESTRICT, so ' +
      'this cannot happen in ordinary operation. The one window where it can is ' +
      "`db:purge-fixture-orgs`'s `session_replication_role = 'replica'`, which " +
      'suspends foreign keys along with the immutability triggers. Find the rows by ' +
      'org_id before anything else writes to this database.',
  );
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

  // The fifth section, report-only for the same reason the three above are: the
  // exit code belongs to the two things that make the DEPLOYED CODE fail, and an
  // orphaned row is a data incident on an existing database. It is wrapped
  // because it is the only section that reads user rows — a table this connection
  // cannot select from must not take down the report the owner is pasting into an
  // incident.
  let orphans: OrphanSection;
  try {
    orphans = await orphanOrgRowSection(sql);
  } catch (error) {
    orphans = { kind: 'unavailable', reason: (error as Error).message };
  }
  reportOrphans(orphans);

  const compositeFks = await compositeSetNullFks(sql);
  const unnarrowed = compositeFks
    .map((fk) => ({ fk, problem: narrowingProblem(fk) }))
    .filter((checked) => checked.problem !== undefined)
    .map((checked) => `  - ${checked.fk.name} (on ${checked.fk.child}) ${checked.problem ?? ''}`);

  // THE FLOOR, and the reason it is here: this section reports what the database
  // HAS, so an empty answer read "0 found, every one narrowed" and exited 0 — a
  // gate with no guard on the guard (wave 7 L3). The number is DERIVED from
  // `src/schema/` and never written down here: it read eleven while `files.ts`
  // declared no FK for `category_id`, and became twelve the moment that
  // declaration landed, with nothing in this file edited.
  //
  // A floor rather than an equality, still. `files_category_same_org_fk` is the
  // worked example of why: for thirteen migrations the database held a composite
  // set-null FK the code did not declare, and an equality would have failed this
  // check on every database rather than reporting it.
  const declaredFks = declaredCompositeSetNullFks();
  const behind = compositeFks.length < declaredFks.size;

  if (unnarrowed.length === 0 && !behind) {
    console.log(
      `assert-schema-applied: composite set-null FKs — ${compositeFks.length} found ` +
        `(${declaredFks.size} declared in src/schema/), every one narrowed to a single ` +
        'non-org_id column.',
    );
  } else if (unnarrowed.length > 0) {
    console.error(
      `assert-schema-applied: composite set-null FKs — ${compositeFks.length} found, ` +
        `${unnarrowed.length} NOT NARROWED (this FAILS the check):\n${unnarrowed.join('\n')}\n\n` +
        'Migration 0052 narrows each of these to the one column it references. An ' +
        'un-narrowed composite SET NULL nulls EVERY referencing column on a parent ' +
        'delete, org_id included — the row keeps existing with no tenant.',
    );
  }
  if (behind) {
    console.error(
      `assert-schema-applied: composite set-null FKs — only ${compositeFks.length} found and ` +
        `src/schema/ declares ${declaredFks.size} (this FAILS the check). Either this database ` +
        'is behind the code, or a composite ON DELETE SET NULL was re-created with a different ' +
        'referential action — which this section would otherwise report as nothing at all.',
    );
  }

  return columnGaps.length > 0 || unnarrowed.length > 0 || behind ? 1 : 0;
}
