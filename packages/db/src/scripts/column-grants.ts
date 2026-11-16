// The tables whose metra_app privilege is narrower than the table, read back
// COLUMN BY COLUMN after apply-rls (verify-rls-applied.ts). A
// table-level grant covers every column, so it is reported as the surplus
// column it lets through; a column the app writes and may not is an outage,
// and is reported too.
//
//   contract_line_measurements INSERT  every column but `seq` (security review
//     S1): `seq` orders the final measured quantities, and a writer who could
//     set it (OVERRIDING SYSTEM VALUE) would outrank every later correction.
//   contract_cost_entries UPDATE  the entry fields an edit writes and the
//     void's stamp, nothing else (DB step B, B3 security S2): an entry never
//     moves to another contract, and who recorded it, its key and its creation
//     time never change.
//   contract_payment_claims UPDATE  the answer's columns only (DB step B, B4
//     security S1): the studio confirms or dismisses a claim, and never
//     rewrites what the client claimed, its note, name, IP or user agent.
//   client_payment_claims UPDATE  the same rule for the design payment's claim
//     (security batch 3, A5).
//   api_keys UPDATE  the revoke's two columns (security batch 3, A5): a key
//     resolves through its creator's live role, so `created_by` never changes.
//
// THE LISTS ARE THE INVARIANT (./column-grant-sets.ts), not read from
// roles.sql, which is their implementation: an edit that widened a grant would
// move roles.sql and stay red here.
//
// THE WORDS OF THE TWO NEWEST RULES ARE DELIBERATE. The app-side drift scan
// refuses any string in this package that reads as SQL writing a scanned table
// (the verb, then the table's name), so their problem lines say "holds the
// privilege ON THE COLUMN" and never put the verb in front of the table.
import type { createSql } from '../client';
import {
  API_KEY_UPDATE_COLUMNS,
  CLAIM_UPDATE_COLUMNS,
  CLIENT_CLAIM_UPDATE_COLUMNS,
  COST_ENTRY_UPDATE_COLUMNS,
} from './column-grant-sets';
import { APP_ROLE } from './roles-grants';

type Sql = ReturnType<typeof createSql>;

interface ColumnGrantRule {
  table: string;
  privilege: 'select' | 'insert' | 'update';
  /** Is metra_app meant to hold the privilege on this column? */
  granted: (column: string) => boolean;
  /** The problem line for a column it holds and must not. */
  surplus: (column: string) => string;
  /** The problem line for a column it needs and does not hold. */
  missing: (column: string) => string;
}

const COLUMN_GRANT_RULES: readonly ColumnGrantRule[] = [
  {
    table: 'contract_line_measurements',
    privilege: 'insert',
    granted: (column) => column !== 'seq',
    surplus: (column) =>
      `  - ${APP_ROLE} may INSERT contract_line_measurements.${column}, so it can choose the recording order. ` +
      'rls/roles.sql grants insert on every other column only',
    missing: (column) =>
      `  - ${APP_ROLE} may NOT insert contract_line_measurements.${column}: every measurement write will fail with 42501`,
  },
  {
    table: 'contract_cost_entries',
    privilege: 'update',
    granted: (column) => COST_ENTRY_UPDATE_COLUMNS.has(column),
    surplus: (column) =>
      `  - ${APP_ROLE} may UPDATE contract_cost_entries.${column}, which no edit or void writes. ` +
      'rls/roles.sql grants update on the entry fields and the void stamp only',
    missing: (column) =>
      `  - ${APP_ROLE} may NOT update contract_cost_entries.${column}: every cost edit or void will fail with 42501`,
  },
  {
    table: 'contract_payment_claims',
    privilege: 'update',
    granted: (column) => CLAIM_UPDATE_COLUMNS.has(column),
    surplus: (column) =>
      `  - ${APP_ROLE} may UPDATE contract_payment_claims.${column}, which no confirm or dismiss writes. ` +
      "rls/roles.sql grants update on the answer's columns only",
    missing: (column) =>
      `  - ${APP_ROLE} may NOT update contract_payment_claims.${column}: every claim confirm or dismiss will fail with 42501`,
  },
  {
    table: 'client_verification_codes',
    privilege: 'select',
    granted: (column) => column !== 'code_hash',
    surplus: (column) =>
      `  - ${APP_ROLE} may READ client_verification_codes.${column}, the hash a client's one-time code is ` +
      'checked against (a million guesses from the code). rls/roles.sql grants select on every other column only',
    missing: (column) =>
      `  - ${APP_ROLE} may NOT read client_verification_codes.${column}: the studio's reads of the codes will fail with 42501`,
  },
  {
    table: 'client_payment_claims',
    privilege: 'update',
    granted: (column) => CLIENT_CLAIM_UPDATE_COLUMNS.has(column),
    surplus: (column) =>
      `  - ${APP_ROLE} holds UPDATE on the column client_payment_claims.${column}, which no confirm or dismiss writes. ` +
      "rls/roles.sql grants it on the answer's columns only",
    missing: (column) =>
      `  - ${APP_ROLE} holds NO UPDATE on the column client_payment_claims.${column}: every design-payment claim confirm or dismiss will fail with 42501`,
  },
  {
    table: 'api_keys',
    privilege: 'update',
    granted: (column) => API_KEY_UPDATE_COLUMNS.has(column),
    surplus: (column) =>
      `  - ${APP_ROLE} holds UPDATE on the column api_keys.${column}, which no revoke writes. ` +
      "rls/roles.sql grants it on the revoke's two columns only",
    missing: (column) =>
      `  - ${APP_ROLE} holds NO UPDATE on the column api_keys.${column}: every API key revoke, and every member removal, will fail with 42501`,
  },
];

async function ruleProblems(sql: Sql, rule: ColumnGrantRule): Promise<string[]> {
  const rows = (await sql`
    select a.attname as name,
           has_column_privilege(${APP_ROLE}::name, c.oid, a.attnum, ${rule.privilege}) as granted
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid
     where c.relname = ${rule.table} and c.relnamespace = 'public'::regnamespace
       and a.attnum > 0 and not a.attisdropped
     order by a.attnum
  `) as unknown as Array<{ name: string; granted: boolean }>;
  if (rows.length === 0) return [`  - ${rule.table} is not in this database at all. Run the migrations first.`];
  return rows.flatMap((row) => {
    if (row.granted && !rule.granted(row.name)) return [rule.surplus(row.name)];
    if (!row.granted && rule.granted(row.name)) return [rule.missing(row.name)];
    return [];
  });
}

/** One line per column whose grant differs from its rule, every rule asked. */
export async function columnGrantProblems(sql: Sql): Promise<string[]> {
  const problems: string[] = [];
  for (const rule of COLUMN_GRANT_RULES) problems.push(...(await ruleProblems(sql, rule)));
  return problems;
}

/** What the column read-back checked, for the green line apply-rls prints. */
export function columnGrantsSummary(): string {
  return (
    'contract_line_measurements insertable on every column but seq; contract_cost_entries ' +
    `updatable on its ${String(COST_ENTRY_UPDATE_COLUMNS.size)} entry and void columns only; ` +
    `contract_payment_claims updatable on its ${String(CLAIM_UPDATE_COLUMNS.size)} answer columns only; ` +
    'client_verification_codes readable on every column but code_hash; ' +
    `client_payment_claims updatable on its ${String(CLIENT_CLAIM_UPDATE_COLUMNS.size)} answer columns only; ` +
    `api_keys updatable on its ${String(API_KEY_UPDATE_COLUMNS.size)} revoke columns only`
  );
}
