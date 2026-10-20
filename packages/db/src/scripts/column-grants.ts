// The two Stage 2 tables whose metra_app privilege is narrower than the table,
// read back COLUMN BY COLUMN after apply-rls (verify-rls-applied.ts). A
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
//
// THE LISTS ARE WRITTEN HERE, not read from roles.sql: they are the invariant,
// roles.sql is its implementation, so an edit that widened the grant would
// move roles.sql and stay red here.
import type { createSql } from '../client';
import { APP_ROLE } from './roles-grants';

type Sql = ReturnType<typeof createSql>;

/** The cost entry columns an edit and a void write (lib/execution/costs). */
export const COST_ENTRY_UPDATE_COLUMNS: ReadonlySet<string> = new Set([
  'contract_section_id',
  'contract_line_id',
  'cost_item_id',
  'category',
  'description',
  'qty',
  'unit',
  'unit_cost',
  'amount',
  'incurred_on',
  'supplier',
  'reference',
  'voided_at',
  'voided_by',
  'updated_at',
]);

interface ColumnGrantRule {
  table: string;
  privilege: 'insert' | 'update';
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
    `updatable on its ${String(COST_ENTRY_UPDATE_COLUMNS.size)} entry and void columns only`
  );
}
