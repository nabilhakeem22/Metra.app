// The two read-backs that report what the database has BEYOND the manifest:
// surplus policies, and the table privileges roles.sql grants on no table.
import { APP_ROLE } from './roles-grants';
import type { Sql } from './verify-rls-shared';

/**
 * Policies the database has and NO manifest file declares (security review S4).
 * The one exception to "one-directional": policies are PERMISSIVE and OR
 * together, so a surplus `using (true)` on any table opens it to every caller,
 * and a re-run of apply-rls (which drops and re-creates only the policies it
 * declares) leaves it in place. Every table in `public` is ours, so a surplus
 * here is never legitimate.
 */
export function surplusPolicies(declared: Map<string, string>, applied: Set<string>): string[] {
  return [...applied]
    .filter((key) => !declared.has(key))
    .sort()
    .map(
      (key) =>
        `  - policy ${key} is in the database and declared by NO rls/ file: policies OR ` +
        'together, so it widens what the declared one allows. Drop it, then re-run apply-rls',
    );
}

/** Table privileges roles.sql grants metra_app on NO table. */
export const NEVER_GRANTED_PRIVILEGES = ['truncate', 'references', 'trigger'] as const;

/**
 * Does metra_app hold TRUNCATE, REFERENCES or TRIGGER on any table (security
 * review S4)? roles.sql grants none of them anywhere, and TRUNCATE is the
 * dangerous one: it ignores RLS and fires no row trigger, so it would empty a
 * ledger across every studio and pass the payment request's frozen guard. The
 * six Stage 2 tables converge by `revoke all` on every run; on an older table
 * a surplus survives apply-rls and only a human can explain it.
 */
export async function neverGrantedPrivilegeProblems(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    select c.relname as name, p.name as privilege
      from pg_class c
      cross join (values ('truncate'), ('references'), ('trigger')) as p(name)
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and has_table_privilege(${APP_ROLE}::name, c.oid, p.name)
     order by 1, 2
  `) as unknown as Array<{ name: string; privilege: (typeof NEVER_GRANTED_PRIVILEGES)[number] }>;
  return rows.map(
    (row) =>
      `  - ${APP_ROLE} has ${row.privilege} on ${row.name}, which rls/roles.sql grants on no ` +
      'table. Re-run apply-rls; if it survives that, someone granted it by hand',
  );
}
