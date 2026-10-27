// The catalogue reads `verifyRlsApplied` compares the manifest against: RLS
// flags, policies, triggers, functions, and the metra_app role itself.
import { APP_ROLE } from './roles-grants';
import type { Sql } from './verify-rls-shared';

export async function rlsFlags(sql: Sql): Promise<Map<string, { enabled: boolean; forced: boolean }>> {
  const rows = (await sql`
    select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  `) as unknown as Array<{ name: string; enabled: boolean; forced: boolean }>;
  return new Map(rows.map((row) => [row.name, { enabled: row.enabled, forced: row.forced }]));
}

export async function appliedPolicies(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select tablename, policyname from pg_policies where schemaname = 'public'
  `) as unknown as Array<{ tablename: string; policyname: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.policyname}`));
}

export async function appliedTriggers(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select c.relname as tablename, t.tgname as triggername
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  `) as unknown as Array<{ tablename: string; triggername: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.triggername}`));
}

export async function appliedFunctions(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  `) as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export async function appRoleProblems(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    select rolcanlogin as "canLogin", rolbypassrls as "bypassRls"
      from pg_roles where rolname = ${APP_ROLE}
  `) as unknown as Array<{ canLogin: boolean; bypassRls: boolean }>;
  if (rows.length === 0) {
    return [`  - role ${APP_ROLE} does not exist — roles.sql did not run`];
  }
  const [role] = rows;
  if (role.canLogin || role.bypassRls) {
    return [
      `  - role ${APP_ROLE} is too strong: canlogin=${String(role.canLogin)} ` +
        `bypassrls=${String(role.bypassRls)} — it must be neither`,
    ];
  }
  return [];
}
