// The table-level grant read-back on the NARROWED tables: what roles.sql leaves
// metra_app with after its revokes, and never the privilege a narrowing removes.
import { readFileSync } from 'node:fs';
import {
  APP_ROLE,
  TABLE_PRIVILEGES,
  describePrivileges,
  tablePrivilegesFor,
  type TablePrivilege,
} from './roles-grants';
import { NARROWED_TABLES } from './verify-rls-narrowed-tables';
import { ROLES_SQL, type Sql } from './verify-rls-shared';

/** One cell of the table-privilege read-back. */
export interface AppliedPrivilege {
  table_name: string;
  privilege: string;
  /** False when this database has no such table — see the read below. */
  table_exists: boolean;
  granted: boolean;
}

/** roles.sql against the database, in both directions, for one table. */
function declaredPrivilegeDriftProblems(
  table: string,
  declared: ReadonlySet<TablePrivilege>,
  applied: ReadonlySet<TablePrivilege>,
): string[] {
  const missing = TABLE_PRIVILEGES.filter(
    (privilege) => declared.has(privilege) && !applied.has(privilege),
  );
  const surplus = TABLE_PRIVILEGES.filter(
    (privilege) => applied.has(privilege) && !declared.has(privilege),
  );
  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(
      `  - ${APP_ROLE} is MISSING ${missing.join(', ')} on ${table} — rls/roles.sql ` +
        `grants ${describePrivileges(declared)} and this database has ` +
        `${describePrivileges(applied)}`,
    );
  }
  if (surplus.length > 0) {
    problems.push(
      `  - ${APP_ROLE} still has ${surplus.join(', ')} on ${table}, which rls/roles.sql ` +
        `REVOKES — it grants ${describePrivileges(declared)} and this database has ` +
        `${describePrivileges(applied)}. A revoke converges only if it RAN, and that ` +
        'line exists for databases provisioned before the narrowing was written',
    );
  }
  return problems;
}

/**
 * The invariant, asked of BOTH sides. The comparison against roles.sql follows
 * it wherever it goes; this does not move, so an edit that re-granted the
 * privilege is reported from the file AND from the database.
 */
function forbiddenPrivilegeProblems(
  table: string,
  declared: ReadonlySet<TablePrivilege>,
  applied: ReadonlySet<TablePrivilege>,
): string[] {
  const problems: string[] = [];
  for (const forbidden of NARROWED_TABLES[table]) {
    if (declared.has(forbidden)) {
      problems.push(
        `  - rls/roles.sql GRANTS ${forbidden} on ${table} to ${APP_ROLE}, and it must ` +
          'not. This is a deliberate narrowing, not an oversight — re-granting it ' +
          'needs the commit that builds the path that needs it, and an update to this ' +
          'list in verify-rls-applied.ts',
      );
    }
    if (applied.has(forbidden)) {
      problems.push(
        `  - ${APP_ROLE} has ${forbidden} on ${table} in THIS DATABASE, and it must ` +
          'not. Re-run apply-rls; if it survives that, someone granted it by hand',
      );
    }
  }
  return problems;
}

/** Every problem with one narrowed table, given the whole privilege matrix. */
function narrowedTableProblems(table: string, rows: AppliedPrivilege[], rolesSql: string): string[] {
  const declared = tablePrivilegesFor(rolesSql, table);
  const applied = new Set(
    rows
      .filter((row) => row.table_name === table && row.granted)
      .map((row) => row.privilege as TablePrivilege),
  );
  const answered = rows.filter((row) => row.table_name === table);
  if (answered.length === 0) {
    return [
      `  - ${table} was not read back at all — the privilege matrix returned no row ` +
        'for it, so nothing here says anything about its grants',
    ];
  }
  if (!answered[0].table_exists) {
    return [
      `  - ${table} is not in this database at all, so its grants cannot be checked. ` +
        'Run the migrations first.',
    ];
  }
  return [
    ...declaredPrivilegeDriftProblems(table, declared, applied),
    ...forbiddenPrivilegeProblems(table, declared, applied),
  ];
}

/**
 * Do the TABLE-LEVEL grants on the narrowed tables match what roles.sql declares?
 *
 * Read with `has_table_privilege`, one call per (table, privilege), because that
 * function reports the EFFECTIVE answer for any operator — unlike
 * `information_schema.table_privileges`, which shows only rows whose grantor or
 * grantee is a currently enabled role and therefore answers differently depending
 * on who is running `apply-rls`. A post-condition that answers differently for
 * two operators is not a post-condition (wave 7 D7 learned this on the column
 * half).
 *
 * BOTH DIRECTIONS ARE REPORTED. A missing privilege is an outage — the studio
 * cockpit 42501s. A SURPLUS one is the failure this exists for: the narrowing
 * silently absent on a database provisioned before it was written.
 */
export async function narrowedTableGrantProblems(sql: Sql): Promise<string[]> {
  const rolesSql = readFileSync(ROLES_SQL, 'utf8');
  const tables = Object.keys(NARROWED_TABLES).sort();
  const privileges = [...TABLE_PRIVILEGES];
  // Resolved through `pg_class`, not through `('public.' || name)::text`: that
  // form raises 42P01 on a table the database does not have, and the exception
  // would escape `verifyRlsApplied` and discard every problem already collected
  // (wave 8 F9). A LEFT JOIN gives a null oid, the strict privilege function
  // answers null on it, and the missing table is reported as its own line.
  const rows = (await sql`
    select t.name as table_name, p.name as privilege,
           c.oid is not null as table_exists,
           coalesce(has_table_privilege(${APP_ROLE}::name, c.oid, p.name), false) as granted
      from unnest(${tables}::text[]) as t(name)
      cross join unnest(${privileges}::text[]) as p(name)
      left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
     order by 1, 2
  `) as unknown as AppliedPrivilege[];
  return tables.flatMap((table) => narrowedTableProblems(table, rows, rolesSql));
}
