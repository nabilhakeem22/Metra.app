// "Is there a row anywhere whose `org_id` names no organization?" — built as SQL
// TEXT, so the question can be unit-tested without a database and asked from two
// places that hold different kinds of handle.
//
// WHY IT HAS TO BE ASKED AT ALL. Every org-scoped table carries
// `org_id -> organizations(id) ON DELETE RESTRICT`, so in ordinary operation an
// orphan is impossible: the delete is refused. The purge opens exactly one window
// where it is not — `set local session_replication_role = 'replica'` suspends the
// immutability TRIGGERS so frozen proposal/contract/variation rows can be removed,
// and the same setting suspends FOREIGN KEY enforcement with them. A table missing
// from the delete list inside that window is not an error; it is a silent orphan,
// which is exactly how the fixture teardown lost the BOQ tables when 0041 landed
// and nobody found out until someone read the list.
//
// TWO CALLERS, ONE QUESTION:
//   * `purge-fixture-orgs.ts` runs it after the purge and THROWS on a non-zero —
//     the purge's post-condition, and the only thing that can see into that window;
//   * `schema-check.ts` runs it inside `assert-schema-applied` and REPORTS —
//     report-only, like indexes/constraints/functions, because an orphan found on
//     a live database is an incident to investigate rather than a reason to refuse
//     to print the rest of the report.
//
// THE FAILURE DIRECTION IS LOUD, NOT SILENT, and that is deliberate. If the
// connection running this could not SEE `public.organizations` — RLS applied to a
// role without BYPASSRLS — the subquery would return no ids, `org_id not in ()`
// would be true for every row, and every table would report fully orphaned. A
// false ALARM. `ORGANIZATIONS_VISIBLE_QUERY` is the guard on the guard: it is read
// first, and a zero there means "this connection cannot see organizations", which
// both callers say in as many words instead of pointing at 44 innocent tables.
//
// The table names are never caller-supplied: they are checked against
// `orgScopedTableNames()`, derived from the drizzle schema, and against a
// conservative identifier shape, before any of them reaches a string.
import { orgScopedTableNames } from './schema-catalogue';

/** One table's answer. `rows` is how many of its rows name no organization. */
export interface OrphanOrgRows {
  table_name: string;
  rows: number;
}

/**
 * How many organizations this connection can see. Zero means the orphan counts
 * below are meaningless (and would all read "fully orphaned"), not that the
 * database is empty — `organizations` is never empty on a database that has
 * anything to orphan.
 */
export const ORGANIZATIONS_VISIBLE_QUERY =
  'select count(*)::int as rows from public.organizations';

/** A bare lower-case SQL identifier. Nothing here is ever quoted. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/**
 * `select '<t>' as table_name, count(*) … union all …` over every named table.
 *
 * Refuses a table that is not an org-scoped table of the drizzle schema, so the
 * interpolation below cannot be reached by anything but a name this repository
 * declares. Returns one row per table INCLUDING the zeroes, because "boqs: 0" is
 * the line that proves the table was actually asked about.
 */
export function orphanOrgRowsQuery(tables: readonly string[]): string {
  if (tables.length === 0) {
    throw new Error('orphanOrgRowsQuery: no tables — that would check nothing and report OK');
  }
  const declared = new Set(orgScopedTableNames());
  for (const table of tables) {
    if (!IDENTIFIER.test(table)) {
      throw new Error(`orphanOrgRowsQuery: ${table} is not a bare lower-case identifier`);
    }
    if (!declared.has(table)) {
      throw new Error(
        `orphanOrgRowsQuery: ${table} is not an org-scoped table in src/schema/ — ` +
          'this query is built from the schema and never from a caller-supplied name',
      );
    }
  }
  return `${tables
    .map(
      (table) =>
        `select '${table}' as table_name, count(*)::int as rows from public.${table} ` +
        'where org_id not in (select id from public.organizations)',
    )
    .join('\n  union all\n')}\n  order by 1`;
}

/** Only the tables that actually hold an orphan, which is what anyone reports. */
export function orphanedTables(counts: readonly OrphanOrgRows[]): OrphanOrgRows[] {
  return counts.filter((count) => count.rows > 0);
}

/**
 * The line each caller prints or throws with. One shape, so the purge's failure
 * and the report's warning cannot describe the same finding two different ways.
 */
export function orphanReportLines(counts: readonly OrphanOrgRows[]): string[] {
  return orphanedTables(counts).map(
    (count) =>
      `  - ${count.table_name}: ${String(count.rows)} row(s) whose org_id names no ` +
      'organization',
  );
}
