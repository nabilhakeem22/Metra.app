// What `rls/roles.sql` says about UPDATE on `design_engagements`, read from the
// text in ONE place.
//
// Two gates depend on these answers and must not disagree about them:
//
//   * `apps/web/.../design-engagement-grants.test.ts` compares the granted list
//     against every column the APP writes, with no database, before the grant is
//     applied — and refuses a statement that would re-widen it;
//   * `verify-rls-applied.ts` compares the same list against what the DATABASE
//     actually granted, on the connection `apply-rls` just used.
//
// Two copies of these regexes would be two definitions of "the granted set", and
// the first drift between them would be silent in both directions. Pure text in,
// names out: no fs, no postgres, importable from either side.
//
// EVERY QUESTION IS ASKED OF COMMENT-FREE TEXT. The guard that refuses a
// re-widening was first written against the raw file and matched a SENTENCE in
// roles.sql's own header explaining why re-widening is forbidden. Prose cannot be
// allowed to fail a gate, and — the direction that matters — prose cannot be
// allowed to satisfy one.
//
// THE STATEMENT SPLITTER MOVED TO `roles-grants.ts` (wave 8 item 6), which asks
// the same three questions of every table's grants rather than this one table's.
// It is one definition of "does this statement name that table" and "does it
// reach metra_app", for the same reason this file exists at all: two copies drift
// silently. What stays HERE is the part that is only true of this table — the
// COLUMN list, and the rule that a table-level UPDATE anywhere makes it cosmetic.
import {
  namesTable,
  privilegeStatements,
  reachesAppRole,
} from './roles-grants';
import { scannableSql } from './sql-text';

/** The table whose UPDATE is narrowed to columns. */
export const GRANTED_UPDATE_TABLE = 'design_engagements';

const COLUMN_GRANT =
  /grant\s+update\s*\(([^)]*)\)\s*on\s+public\.design_engagements\s+to\s+metra_app\s*;/i;

/** A REVOKE of table-level UPDATE on the table, in any spelling. */
const TABLE_LEVEL_REVOKE =
  /\brevoke\b[^;]*\bupdate\b[^;]*\bon\s+public\.design_engagements[^;]*;/gi;

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
 * The column names of `grant update (…) on public.design_engagements to
 * metra_app;`, in the order the file lists them. Throws if the statement is not
 * there at all — a missing grant must be a loud failure in both callers, never an
 * empty list that compares equal to an empty database read.
 */
export function grantedUpdateColumns(rolesSql: string): string[] {
  const match = COLUMN_GRANT.exec(scannableSql(rolesSql));
  if (!match) {
    throw new Error(
      'roles.sql has no `grant update (…) on public.design_engagements to metra_app;`',
    );
  }
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Every statement that would hand metra_app UPDATE on the whole
 * `design_engagements` row. Must be empty: a table-level UPDATE subsumes every
 * column grant, so one of these makes the narrowing in roles.sql cosmetic.
 */
export function tableLevelUpdateGrants(rolesSql: string): string[] {
  return privilegeStatements(rolesSql)
    .filter(
      (statement) =>
        statement.verb === 'grant' &&
        grantsWholeRowUpdate(statement.privileges) &&
        namesTable(statement.targets, GRANTED_UPDATE_TABLE) &&
        reachesAppRole(statement.grantees),
    )
    .map((statement) => statement.text);
}

/**
 * Every table-level `revoke update`, split by where it sits relative to the
 * column grant. A revoke AFTER the grant is not a tidy-up: PostgreSQL revokes the
 * corresponding column privileges with it, leaving metra_app unable to update the
 * table at all. Reported as all matches, because checking only the first one let
 * exactly that edit through (wave 7 S2).
 */
export function updateRevokes(rolesSql: string): { before: string[]; after: string[] } {
  const text = scannableSql(rolesSql);
  const grantAt = text.search(COLUMN_GRANT);
  if (grantAt === -1) {
    throw new Error(
      'roles.sql has no `grant update (…) on public.design_engagements to metra_app;`',
    );
  }
  const before: string[] = [];
  const after: string[] = [];
  for (const match of text.matchAll(TABLE_LEVEL_REVOKE)) {
    const statement = match[0].replace(/\s+/g, ' ').trim();
    (match.index < grantAt ? before : after).push(statement);
  }
  return { before, after };
}
