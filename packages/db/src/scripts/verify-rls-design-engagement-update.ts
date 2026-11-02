// The `design_engagements` UPDATE authority read-back: no table-level UPDATE for
// metra_app, and a column-level UPDATE naming exactly what roles.sql grants.
import { readFileSync } from 'node:fs';
import { GRANTED_UPDATE_TABLE, grantedUpdateColumns } from './design-engagement-grant';
import { APP_ROLE } from './roles-grants';
import { ROLES_SQL, type Sql } from './verify-rls-shared';

/** What metra_app holds on `design_engagements`, as the first read answers it. */
interface UpdatePrivilege {
  tableExists: boolean;
  tableLevel: boolean;
  columnLevel: boolean;
}

/**
 * GUARDED ON THE TABLE EXISTING (wave 8 F9). `has_table_privilege(…, text, …)`
 * raises 42P01 on a name the database does not have, and that exception is not
 * a problem LINE — it escapes `verifyRlsApplied` and throws away every problem
 * already collected, so a database missing this table reports nothing about
 * the forty-six it has. Resolved through `pg_class` instead: a LEFT JOIN
 * yields a null oid, the privilege functions are strict and answer null on it,
 * and "the table is not there" becomes a line like any other.
 */
async function readUpdatePrivilege(sql: Sql): Promise<UpdatePrivilege | undefined> {
  const [privilege] = (await sql`
    select c.oid is not null as "tableExists",
           coalesce(has_table_privilege(${APP_ROLE}::name, c.oid, 'update'), false)
             as "tableLevel",
           coalesce(has_any_column_privilege(${APP_ROLE}::name, c.oid, 'update'), false)
             as "columnLevel"
      from (select 1) as present
      left join pg_class c
        on c.relname = 'design_engagements'
       and c.relnamespace = 'public'::regnamespace
  `) as unknown as UpdatePrivilege[];
  return privilege;
}

/**
 * Read the columns through `has_column_privilege` over `pg_attribute` rather
 * than from `information_schema.column_privileges`. That view shows only rows
 * whose grantor or grantee is a CURRENTLY ENABLED role, so what it returns
 * depends on which role happens to be running `apply-rls` — a post-condition
 * that answers differently for two operators is not a post-condition. The
 * catalogue read is the same answer for anyone. `has_column_privilege` is true
 * for a table-level grant as well as a column-level one, which is exactly
 * right here: it reports the EFFECTIVE set, and the table-level half is
 * asserted separately.
 */
async function readUpdatableColumns(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    select a.attname as name
      from pg_attribute a
      join pg_class c     on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'design_engagements'
       and a.attnum > 0 and not a.attisdropped
       and has_column_privilege(${APP_ROLE}::name, c.oid, a.attnum, 'update')
     order by 1
  `) as unknown as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** The table-level half: no table-wide UPDATE, and some column-level one. */
function privilegeLevelProblems(privilege: UpdatePrivilege): string[] {
  const problems: string[] = [];
  if (privilege.tableLevel) {
    problems.push(
      `  - ${APP_ROLE} has TABLE-LEVEL update on ${GRANTED_UPDATE_TABLE}, which subsumes ` +
        'every column grant — the narrowing in rls/roles.sql is cosmetic on this database',
    );
  }
  if (!privilege.columnLevel) {
    problems.push(
      `  - ${APP_ROLE} has NO update at all on ${GRANTED_UPDATE_TABLE} — every state ` +
        'transition, ROM issue, render stamp and share-token mint will fail with 42501',
    );
  }
  return problems;
}

/** Both halves, compared against the columns roles.sql grants. */
function columnDriftProblems(privilege: UpdatePrivilege, columns: string[]): string[] {
  const problems = privilegeLevelProblems(privilege);
  const granted = new Set(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')));
  const applied = new Set(columns);
  const missing = [...granted].filter((column) => !applied.has(column)).sort();
  const surplus = [...applied].filter((column) => !granted.has(column)).sort();
  if (missing.length > 0) {
    problems.push(
      `  - ${GRANTED_UPDATE_TABLE} column update is MISSING ${missing.join(', ')} — ` +
        'rls/roles.sql grants them and this database does not have them',
    );
  }
  if (surplus.length > 0) {
    problems.push(
      `  - ${GRANTED_UPDATE_TABLE} column update carries ${surplus.join(', ')}, which ` +
        'rls/roles.sql does not grant — a privilege nothing in the repository asked for',
    );
  }
  return problems;
}

/**
 * The `design_engagements` UPDATE authority, compared against roles.sql itself —
 * the same reader the app-side drift test uses, so the two gates cannot disagree
 * about what "granted" means.
 */
export async function designEngagementUpdateProblems(sql: Sql): Promise<string[]> {
  const privilege = await readUpdatePrivilege(sql);
  if (!privilege || !privilege.tableExists) {
    return [
      `  - ${GRANTED_UPDATE_TABLE} is not in this database at all, so nothing here ` +
        'says anything about its UPDATE authority. Run the migrations first.',
    ];
  }
  return columnDriftProblems(privilege, await readUpdatableColumns(sql));
}
