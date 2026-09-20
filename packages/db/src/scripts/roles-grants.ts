// What `rls/roles.sql` grants `metra_app` on a TABLE, read from the text in one
// place — and the statement splitter both readers of that file share.
//
// THE GAP THIS CLOSES. Wave 7 gave `design_engagements` a column-level UPDATE and
// a database-side read-back to prove it landed. Every OTHER narrowing in
// roles.sql — `revoke delete on boqs`, the INSERT-only schedule
// (`engagement_milestones`), the append-only thread
// (`engagement_document_comments`), the un-self-escalatable plan row
// (`workspace_entitlements`), the undeletable filing vocabulary
// (`document_categories`) — was verified by nothing at all. `apply-rls` printed
// "verified in the catalogues — 46 tables, 46 policies …" whether the revoke had
// landed or not, on a database that might have been provisioned before the revoke
// was written (which is the case every one of those `revoke` lines exists for).
//
// A REVOKE IS NOT IDEMPOTENT IN THE WAY A GRANT IS. `grant` converges: run it
// twice and the privilege is there. `revoke` converges too — but only if it RAN.
// Five of these lines exist solely to remove a privilege from databases
// provisioned before the narrowing was written, which means the databases they
// matter on are exactly the ones where nobody can tell by looking at the file.
// `has_table_privilege` on the applied database is the only honest answer.
//
// THE PRIVILEGE SET IS REPLAYED IN FILE ORDER, because order is load-bearing here
// in both directions: `grant select, insert, update, delete on boqs` followed by
// `revoke delete on boqs` is SELECT/INSERT/UPDATE, and the same two lines the
// other way round are all four.
//
// COLUMN-LEVEL GRANTS ARE NOT TABLE-LEVEL PRIVILEGES and are skipped here.
// `grant update (state, …) on design_engagements` confers no table-level UPDATE,
// which is the entire point of wave 7's narrowing — `design-engagement-grant.ts`
// reads that statement, and this file must not double-count it.
//
// Pure text in, privileges out: no fs, no postgres, importable from either side.
import { scannableSql } from './sql-text';

/** The role every org-scoped query runs as. */
export const APP_ROLE = 'metra_app';

/** The four table privileges this application ever grants or revokes. */
export const TABLE_PRIVILEGES = ['select', 'insert', 'update', 'delete'] as const;
export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

/**
 * One `GRANT`/`REVOKE <privileges> ON <targets> TO|FROM <grantees>`, split at the
 * keywords that separate its three parts — outside parentheses, so a column list
 * cannot be mistaken for the end of the privilege list.
 */
export interface PrivilegeStatement {
  verb: 'grant' | 'revoke';
  privileges: string;
  targets: string;
  grantees: string;
  /** The statement on one line, for a message that names what it found. */
  text: string;
}

/** The index of `keyword` at paren depth 0, or -1. */
export function topLevelKeyword(statement: string, keyword: string): number {
  const pattern = new RegExp(`\\b${keyword}\\b`, 'gi');
  for (const match of statement.matchAll(pattern)) {
    const before = statement.slice(0, match.index);
    const depth = (before.match(/\(/g) ?? []).length - (before.match(/\)/g) ?? []).length;
    if (depth === 0) return match.index;
  }
  return -1;
}

/**
 * Every `grant … on … to …` and `revoke … on … from …` in the file, in FILE
 * ORDER, as its three parts. Comments and string literals are gone before any
 * question is asked of the text: roles.sql's own header explains at length why
 * re-widening is forbidden, and that prose must be able neither to fail a gate
 * nor to satisfy one.
 */
export function privilegeStatements(sql: string): PrivilegeStatement[] {
  const parsed: PrivilegeStatement[] = [];
  for (const raw of scannableSql(sql).split(';')) {
    const statement = raw.trim();
    const verb = /^grant\b/i.test(statement)
      ? 'grant'
      : /^revoke\b/i.test(statement)
        ? 'revoke'
        : null;
    if (!verb) continue;
    const on = topLevelKeyword(statement, 'on');
    if (on === -1) continue; // `grant metra_app to postgres` — a role, not a privilege
    const separator = verb === 'grant' ? 'to' : 'from';
    const tail = topLevelKeyword(statement.slice(on), separator);
    if (tail === -1) continue;
    parsed.push({
      verb,
      privileges: statement.slice(verb.length, on),
      targets: statement.slice(on + 'on'.length, on + tail),
      grantees: statement.slice(on + tail + separator.length),
      text: `${statement.replace(/\s+/g, ' ').trim()};`,
    });
  }
  return parsed;
}

/**
 * The privileges this list confers or removes at TABLE level — every token that
 * does NOT carry its own column list. `ALL` and `ALL PRIVILEGES` are all four and
 * spell none of their names.
 */
export function tableLevelPrivilegesIn(privileges: string): Set<TablePrivilege> {
  const withoutColumnLists = privileges.replace(
    /\b(?:all\s+privileges|all|select|insert|update|references)\s*\([^)]*\)/gi,
    ' ',
  );
  const named = new Set<TablePrivilege>();
  if (/\ball\b/i.test(withoutColumnLists)) {
    for (const privilege of TABLE_PRIVILEGES) named.add(privilege);
    return named;
  }
  for (const privilege of TABLE_PRIVILEGES) {
    if (new RegExp(`\\b${privilege}\\b`, 'i').test(withoutColumnLists)) named.add(privilege);
  }
  return named;
}

/**
 * Does this target list include `table`, however it is spelled? The optional
 * `TABLE` keyword, the optional schema qualification and either identifier being
 * quoted are all the same table. `ON ALL TABLES IN SCHEMA public` names every one
 * of them and is counted too — it is the spelling that would silently re-widen
 * every narrowing in the file at once.
 */
export function namesTable(targets: string, table: string): boolean {
  const cleaned = targets
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '.')
    .trim()
    .toLowerCase();
  if (/\ball tables in schema\b/.test(cleaned)) return true;
  return cleaned
    .replace(/^table\s+/, '')
    .split(',')
    .map((name) => name.trim().replace(/^public\./, ''))
    .includes(table);
}

/** Does this statement reach metra_app? PUBLIC reaches every role, metra_app too. */
export function reachesAppRole(grantees: string): boolean {
  return new RegExp(`\\b(?:${APP_ROLE}|public)\\b`, 'i').test(grantees.replace(/"/g, ''));
}

/**
 * The TABLE-LEVEL privileges `metra_app` ends up with on `table`, by replaying
 * every grant and revoke in roles.sql in file order.
 *
 * This is what the database is compared against. It is NOT "what the file looks
 * like it says": a revoke below a grant removes, a grant below a revoke restores,
 * and reading either line on its own gives the wrong answer for five of the six
 * tables this is used on.
 */
export function tablePrivilegesFor(rolesSql: string, table: string): Set<TablePrivilege> {
  const held = new Set<TablePrivilege>();
  for (const statement of privilegeStatements(rolesSql)) {
    if (!namesTable(statement.targets, table)) continue;
    if (!reachesAppRole(statement.grantees)) continue;
    for (const privilege of tableLevelPrivilegesIn(statement.privileges)) {
      if (statement.verb === 'grant') held.add(privilege);
      else held.delete(privilege);
    }
  }
  return held;
}

/** `select, insert` — the granted set in a stable order, for a message. */
export function describePrivileges(held: ReadonlySet<TablePrivilege>): string {
  const named = TABLE_PRIVILEGES.filter((privilege) => held.has(privilege));
  return named.length > 0 ? named.join(', ') : '(none)';
}
