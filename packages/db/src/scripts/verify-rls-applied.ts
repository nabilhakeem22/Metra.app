// Did `apply-rls` actually LAND? Read back from the catalogues, on the same
// connection, right after the loop.
//
// THE GAP THIS CLOSES. `apply-rls` printed `Applying <file> ...` per file and
// `RLS, roles and functions applied.` at the end - that was the entire
// post-condition. The only structural guard was
// `rls/functions-order.test.ts`'s manifest-coverage case, which proves a file is
// LISTED, not that its objects exist in the database. The failure shape it
// misses is D7's: a `.sql` file that is never applied, silently, with the
// symptom turning up somewhere else entirely.
//
// AND THE LIST IS NOW FIFTEEN FILES, NOT FOUR. Each file is one implicit
// transaction (postgres.js sends it over the simple protocol), so each is atomic
// on its own - but the SEQUENCE is not. `roles.sql` is file 9 and issues all 77
// grants to `metra_app`; the six policy files that enable/force RLS and create
// the 46 policies run AFTER it. A failure between them leaves the next NEW table
// granted to `metra_app` with no RLS and no policy. There are six stop points in
// the policy half now where there used to be one.
//
// WHAT IS CHECKED, and deliberately what is not:
//
//   * every table in the DRIZZLE SCHEMA has relrowsecurity AND
//     relforcerowsecurity - the tenancy invariant itself;
//   * every `create policy` in the manifest files exists in `pg_policies` - the
//     load-bearing one, because it is what catches a file that never ran;
//   * every `create trigger` exists in `pg_trigger` (non-internal);
//   * every function the manifest defines exists in `pg_proc`;
//   * the `metra_app` role exists, and is neither LOGIN nor BYPASSRLS.
//
// NOT indexes and NOT constraints: those carry the known case-fold drift from
// 0017 (twelve names Postgres folded because they were written unquoted), and a
// case-sensitive gate on them would be red on every database including a fresh
// CI one. That is `assert-schema-applied`'s report-only territory and stays
// there.
//
// ONE-DIRECTIONAL, like `schema-catalogue.ts`: an EXTRA policy, trigger or
// function in the database is never reported. Only "the code declares it and the
// database does not have it".
//
// Function names are compared WITHOUT their argument lists, which is the one
// hole worth stating: an overload change (`app_claim_invitation(uuid)` ->
// `(text)`) reads green here.
import type { createSql } from '../client';
import { declaredFunctions, declaredPolicies, declaredTriggers } from './rls-catalogue';
import { declaredTables } from './schema-catalogue';

type Sql = ReturnType<typeof createSql>;

/** The role every org-scoped query runs as. NOLOGIN, NOBYPASSRLS, by design. */
const APP_ROLE = 'metra_app';

async function rlsFlags(sql: Sql): Promise<Map<string, { enabled: boolean; forced: boolean }>> {
  const rows = (await sql`
    select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  `) as unknown as Array<{ name: string; enabled: boolean; forced: boolean }>;
  return new Map(rows.map((row) => [row.name, { enabled: row.enabled, forced: row.forced }]));
}

async function appliedPolicies(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select tablename, policyname from pg_policies where schemaname = 'public'
  `) as unknown as Array<{ tablename: string; policyname: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.policyname}`));
}

async function appliedTriggers(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select c.relname as tablename, t.tgname as triggername
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  `) as unknown as Array<{ tablename: string; triggername: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.triggername}`));
}

async function appliedFunctions(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  `) as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function appRoleProblems(sql: Sql): Promise<string[]> {
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

/** One line per declared object the database does not have. Empty = applied. */
function missing(declared: Map<string, string>, applied: Set<string>, kind: string): string[] {
  return [...declared]
    .filter(([key]) => !applied.has(key))
    .map(([key, file]) => `  - ${kind} ${key} is declared in rls/${file} and is NOT in the database`);
}

/**
 * Read back everything the manifest declares. Returns one line per problem, so
 * the caller decides the exit code and the whole list is printed at once rather
 * than the first failure.
 */
export async function verifyRlsApplied(sql: Sql): Promise<string[]> {
  const problems: string[] = [];

  const flags = await rlsFlags(sql);
  for (const table of declaredTables().keys()) {
    const flag = flags.get(table);
    if (!flag) {
      problems.push(`  - table ${table} is in the drizzle schema and NOT in the database`);
    } else if (!flag.enabled || !flag.forced) {
      problems.push(
        `  - table ${table} has RLS enabled=${String(flag.enabled)} ` +
          `forced=${String(flag.forced)} — both must be true`,
      );
    }
  }

  problems.push(...missing(declaredPolicies(), await appliedPolicies(sql), 'policy'));
  problems.push(...missing(declaredTriggers(), await appliedTriggers(sql), 'trigger'));
  problems.push(...missing(declaredFunctions(), await appliedFunctions(sql), 'function'));
  problems.push(...(await appRoleProblems(sql)));

  return problems;
}

/** The counts a green run prints, so a silently-shrinking manifest is visible. */
export function declaredCounts(): string {
  return (
    `${declaredTables().size} tables, ${declaredPolicies().size} policies, ` +
    `${declaredTriggers().size} triggers, ${declaredFunctions().size} functions`
  );
}
