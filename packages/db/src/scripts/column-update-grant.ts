// What `rls/roles.sql` says about a COLUMN-LEVEL UPDATE on one table, read from
// the text in ONE place.
//
// Three tables carry one today: `design_engagements` (wave 7), and
// `client_payment_claims` and `api_keys` (security batch 3, A5). Two gates
// depend on these answers and must not disagree about them:
//
//   * the app-side drift tests (`apps/web/.../design-engagement-grants.test.ts`,
//     `apps/web/src/lib/db/narrowed-update-grants.test.ts`) compare the granted
//     list against every column the APP writes, with no database, before the
//     grant is applied, and refuse a statement that would re-widen it;
//   * `verify-rls-applied.ts` compares what the DATABASE actually granted, on
//     the connection `apply-rls` just used.
//
// Two copies of these regexes would be two definitions of "the granted set", and
// the first drift between them would be silent in both directions. Pure text in,
// names out: no fs, no postgres, importable from either side.
//
// EVERY QUESTION IS ASKED OF COMMENT-FREE TEXT. The guard that refuses a
// re-widening was first written against the raw file and matched a SENTENCE in
// roles.sql's own header explaining why re-widening is forbidden. Prose cannot be
// allowed to fail a gate, and (the direction that matters) prose cannot be
// allowed to satisfy one.
//
// THE STATEMENT SPLITTER LIVES IN `roles-grants.ts` (wave 8 item 6), which asks
// the same questions of every table's grants. What stays HERE is the part that
// is only true of a column-narrowed table: the COLUMN list, and the rule that a
// table-level UPDATE anywhere makes it cosmetic.
import { namesTable, privilegeStatements, reachesAppRole } from './roles-grants';
import { scannableSql } from './sql-text';

/** The first table whose UPDATE was narrowed to columns (wave 7). */
export const DESIGN_ENGAGEMENTS_TABLE = 'design_engagements';

/** `grant update (…) on public.<table> to metra_app;`, its column list captured. */
function columnGrantOf(table: string): RegExp {
  return new RegExp(String.raw`grant\s+update\s*\(([^)]*)\)\s*on\s+public\.${table}\s+to\s+metra_app\s*;`, 'i');
}

/**
 * A REVOKE that takes table-level UPDATE away from the table, in any spelling:
 * of `update`, or of `all` / `all privileges`, which revoke it without naming it.
 */
function tableLevelRevokeOf(table: string): RegExp {
  return new RegExp(String.raw`\brevoke\b[^;]*\b(?:update|all)\b[^;]*\bon\b[^;]*\bpublic\.${table}\b[^;]*;`, 'gi');
}

function missingColumnGrant(table: string): Error {
  return new Error(`roles.sql has no \`grant update (…) on public.${table} to metra_app;\``);
}

/**
 * Does this privilege list confer UPDATE on the WHOLE ROW?
 *
 * By SHAPE, which is what the first version of this guard only claimed to do
 * (wave 7 S1, M1): a privilege carrying a `( column list )` is column-level and
 * is the form roles.sql uses; anything else that is `ALL`, `ALL PRIVILEGES` or
 * names `UPDATE` is the whole row. `GRANT ALL` spells no word "update" and
 * confers it anyway.
 */
function grantsWholeRowUpdate(privileges: string): boolean {
  const wholeRow = privileges.replace(/\b(?:all\s+privileges|all|update)\s*\([^)]*\)/gi, ' ');
  return /\b(?:all\s+privileges|all|update)\b/i.test(wholeRow);
}

/**
 * The column names of `grant update (…) on public.<table> to metra_app;`, in
 * the order the file lists them. Throws if the statement is not there at all: a
 * missing grant must be a loud failure in every caller, never an empty list
 * that compares equal to an empty database read.
 */
export function grantedUpdateColumnsOf(rolesSql: string, table: string): string[] {
  const match = columnGrantOf(table).exec(scannableSql(rolesSql));
  if (!match) throw missingColumnGrant(table);
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Every statement that would hand metra_app UPDATE on the whole row of `table`.
 * Must be empty: a table-level UPDATE subsumes every column grant, so one of
 * these makes the narrowing in roles.sql cosmetic.
 */
export function tableLevelUpdateGrantsOf(rolesSql: string, table: string): string[] {
  return privilegeStatements(rolesSql)
    .filter(
      (statement) =>
        statement.verb === 'grant' &&
        grantsWholeRowUpdate(statement.privileges) &&
        namesTable(statement.targets, table) &&
        reachesAppRole(statement.grantees),
    )
    .map((statement) => statement.text);
}

/**
 * Every revoke of table-level UPDATE on `table`, split by where it sits relative
 * to the column grant. A revoke AFTER the grant is not a tidy-up: PostgreSQL
 * revokes the corresponding column privileges with it, leaving metra_app unable
 * to update the table at all. Reported as all matches, because checking only the
 * first one let exactly that edit through (wave 7 S2).
 */
export function updateRevokesOf(rolesSql: string, table: string): { before: string[]; after: string[] } {
  const text = scannableSql(rolesSql);
  const grantAt = text.search(columnGrantOf(table));
  if (grantAt === -1) throw missingColumnGrant(table);
  const before: string[] = [];
  const after: string[] = [];
  for (const match of text.matchAll(tableLevelRevokeOf(table))) {
    const statement = match[0].replace(/\s+/g, ' ').trim();
    (match.index < grantAt ? before : after).push(statement);
  }
  return { before, after };
}
